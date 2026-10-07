<?php

namespace App\Services\SenderId;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\SenderId;
use App\Services\Platform\AuditLogger;
use App\Services\Sms\SmsProviderManager;
use App\Support\ErrorCode;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Sender IDs (port of features/sender-ids/service.ts). Statuses PENDING → APPROVED | REJECTED,
 * APPROVED ⇄ SUSPENDED (admin). Only APPROVED sender IDs can be used for sending; masking requests
 * need at least one supporting document.
 */
class SenderIdService
{
    public const MAX_DOCUMENTS = 3;

    public function __construct(
        private readonly SmsProviderManager $providers,
        private readonly DocumentStorage $documents,
        private readonly AuditLogger $audit,
    ) {}

    /** @return Collection<int, SenderId> */
    public function list(TenantContext $ctx): Collection
    {
        $ctx->requirePermission('sender_ids:read');

        return SenderId::query()->where('organizationId', $ctx->organizationId)->orderBy('status')->orderByDesc('createdAt')->get();
    }

    public function find(TenantContext $ctx, string $id): SenderId
    {
        $ctx->requirePermission('sender_ids:read');

        return SenderId::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Sender ID not found.');
    }

    /** Approved sender IDs for pickers (default first). */
    public function approved(string $organizationId): Collection
    {
        return SenderId::query()->where('organizationId', $organizationId)->where('status', 'APPROVED')
            ->orderByDesc('isDefault')->orderBy('value')->get(['id', 'value', 'type', 'isDefault']);
    }

    /**
     * @param  array{value: string, type: string, purpose: string, sampleMessage: string}  $input
     * @param  list<UploadedFile>  $files
     */
    public function request(TenantContext $ctx, array $input, array $files): SenderId
    {
        $ctx->requirePermission('sender_ids:manage');
        $ctx->assertActive();
        $check = $this->providers->provider()->validateSenderId($input['value'], $input['type']);
        if (! $check['valid']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, $check['reason'] ?? 'This sender ID format is not accepted.', ['field' => 'value']);
        }
        $existing = SenderId::query()->where('organizationId', $ctx->organizationId)->where('value', $input['value'])->first();
        if ($existing && $existing->status->value !== 'REJECTED') {
            throw new AppException(ErrorCode::CONFLICT, $existing->status->value === 'APPROVED'
                ? 'This sender ID is already approved for your account.'
                : 'A request for this sender ID is already in progress.', ['field' => 'value']);
        }
        if (SenderId::query()->where('organizationId', $ctx->organizationId)->where('status', 'PENDING')->count() >= 5) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'You can have at most 5 pending requests at a time.');
        }
        $uploads = array_values(array_filter($files, fn (UploadedFile $f) => $f->getSize() > 0));
        if (count($uploads) > self::MAX_DOCUMENTS) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Attach at most '.self::MAX_DOCUMENTS.' documents.', ['field' => 'documents']);
        }
        if ($input['type'] === 'MASKING' && ! $uploads) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Attach at least one supporting document (for example a trade licence).', ['field' => 'documents']);
        }
        $stored = [];
        try {
            foreach ($uploads as $f) {
                $stored[] = $this->documents->store($ctx->organizationId, $f, 'sender-ids');
            }
        } catch (Throwable $e) {
            foreach ($stored as $s) {
                $this->documents->delete($s['key']);
            }
            throw $e;
        }

        $data = [
            'type' => $input['type'], 'purpose' => $input['purpose'], 'sampleMessage' => $input['sampleMessage'], 'documents' => $stored,
            'status' => 'PENDING', 'rejectionReason' => null, 'reviewedAt' => null, 'reviewedById' => null, 'submittedById' => $ctx->userId,
        ];
        if ($existing) {
            $existing->forceFill($data + ['createdAt' => now()])->save();
            $sender = $existing;
        } else {
            $sender = SenderId::query()->forceCreate($data + ['organizationId' => $ctx->organizationId, 'value' => $input['value']]);
        }
        $this->audit->log('sender_id.request', $ctx->actor(), $ctx->organizationId, 'sender_id', $sender->id, ['value' => $sender->value, 'type' => $input['type'], 'documents' => count($stored)]);

        return $sender;
    }

    public function setDefault(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('sender_ids:manage');
        $s = SenderId::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Sender ID not found.');
        if ($s->status->value !== 'APPROVED') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Only approved sender IDs can be the default.');
        }
        DB::transaction(function () use ($ctx, $id) {
            SenderId::query()->where('organizationId', $ctx->organizationId)->update(['isDefault' => false]);
            SenderId::query()->whereKey($id)->update(['isDefault' => true]);
        });
        $this->audit->log('sender_id.set_default', $ctx->actor(), $ctx->organizationId, 'sender_id', $id);
    }

    /** Withdraw a pending request (deletes it and its documents). */
    public function withdraw(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('sender_ids:manage');
        $s = SenderId::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Sender ID not found.');
        if ($s->status->value !== 'PENDING') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Only pending requests can be withdrawn.');
        }
        $s->delete();
        foreach ((array) $s->documents as $d) {
            if (isset($d['key'])) {
                $this->documents->delete($d['key']);
            }
        }
        $this->audit->log('sender_id.withdraw', $ctx->actor(), $ctx->organizationId, 'sender_id', $id, ['value' => $s->value]);
    }

    /**
     * Document download, tenant-scoped (or any tenant for staff: $organizationId = null).
     *
     * @return array{body: string, contentType: string, name: string}
     */
    public function document(?string $organizationId, string $senderId, int $index): array
    {
        $s = SenderId::query()->whereKey($senderId)->when($organizationId, fn ($q) => $q->where('organizationId', $organizationId))->first(['id', 'documents']);
        $doc = $s ? (((array) $s->documents)[$index] ?? null) : null;
        $body = is_array($doc) && isset($doc['key']) ? $this->documents->get($doc['key']) : null;
        if ($body === null) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Document not found.');
        }

        return ['body' => $body, 'contentType' => (string) ($doc['contentType'] ?? 'application/octet-stream'), 'name' => (string) ($doc['name'] ?? 'document')];
    }
}
