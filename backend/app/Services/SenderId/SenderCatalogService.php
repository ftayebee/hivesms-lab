<?php

namespace App\Services\SenderId;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\Organization;
use App\Models\ProviderSenderId;
use App\Models\SenderId;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Services\Sms\SmsProviderManager;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Sender IDs of the upstream provider account and their assignment to customers (docs/22 §5).
 *
 * The catalog (provider_sender_ids) is filled by sync() when the provider's API can list sender IDs,
 * or by hand (Automas documents no such endpoint: its sender IDs live in its web panel). Assigning
 * a catalog entry to organizations writes ordinary APPROVED rows in sender_ids (providerRef =
 * catalog id), so the whole send pipeline — approval checks, defaults, CSV sender validation —
 * works unchanged. Unassigning suspends those rows (history and old messages keep their value).
 * Platform-assigned sender IDs carry no sender-ID fee.
 */
class SenderCatalogService
{
    public function __construct(
        private readonly SmsProviderManager $providers,
        private readonly AuditLogger $audit,
        private readonly NotificationService $notifications,
    ) {}

    private function providerKey(): string
    {
        return $this->providers->provider()->key();
    }

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        $entries = ProviderSenderId::query()->orderBy('type')->orderBy('value')->get();
        $assigned = SenderId::query()->whereIn('providerRef', $entries->pluck('id'))->where('status', 'APPROVED')
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])->get(['id', 'organizationId', 'providerRef', 'isDefault'])
            ->groupBy('providerRef');

        return $entries->map(fn (ProviderSenderId $e) => [
            'id' => $e->id, 'provider' => $e->provider, 'value' => $e->value, 'type' => $e->type->value, 'providerStatus' => $e->providerStatus,
            'source' => $e->source, 'active' => $e->active, 'note' => $e->note, 'lastSyncedAt' => Dhaka::iso($e->lastSyncedAt),
            'assignments' => ($assigned[$e->id] ?? collect())->map(fn ($s) => ['organizationId' => $s->organizationId, 'name' => $s->organization?->name, 'isDefault' => (bool) $s->isDefault])->values()->all(),
        ])->values()->all();
    }

    /** @return array{supported: bool, added: int, updated: int, deactivated: int} */
    public function sync(AdminContext $admin): array
    {
        $provider = $this->providers->provider();
        $listed = $provider->listSenderIds();
        if ($listed === null) {
            throw new AppException(ErrorCode::FEATURE_DISABLED, $provider->displayName().' offers no API to list sender IDs. Add them here by hand as they are approved on the provider panel.');
        }
        $now = now();
        $added = $updated = 0;
        $seen = [];
        DB::transaction(function () use ($listed, $provider, $now, &$added, &$updated, &$seen) {
            foreach ($listed as $s) {
                $value = trim((string) ($s['value'] ?? ''));
                $type = ($s['type'] ?? '') === 'MASKING' ? 'MASKING' : 'NON_MASKING';
                if ($value === '' || mb_strlen($value) > 20) {
                    continue;
                }
                $seen[] = $value;
                $row = ProviderSenderId::query()->where('provider', $provider->key())->where('value', $value)->first();
                if (! $row) {
                    (new ProviderSenderId)->forceFill(['provider' => $provider->key(), 'value' => $value, 'type' => $type, 'providerStatus' => isset($s['status']) ? mb_substr((string) $s['status'], 0, 64) : null,
                        'source' => 'SYNC', 'active' => true, 'lastSyncedAt' => $now])->save();
                    $added++;
                } else {
                    $row->forceFill(['type' => $type, 'providerStatus' => isset($s['status']) ? mb_substr((string) $s['status'], 0, 64) : $row->providerStatus, 'lastSyncedAt' => $now, 'active' => true, 'source' => 'SYNC'])->save();
                    $updated++;
                }
            }
        });
        // Synced entries the provider no longer lists are deactivated (assignments are not touched).
        $deactivated = ProviderSenderId::query()->where('provider', $provider->key())->where('source', 'SYNC')->where('active', true)
            ->when($seen, fn ($q) => $q->whereNotIn('value', $seen))->update(['active' => false, 'updatedAt' => $now->format('Y-m-d H:i:s.v')]);
        $summary = ['supported' => true, 'added' => $added, 'updated' => $updated, 'deactivated' => $deactivated];
        $this->audit->log('sender_catalog.sync', $admin->actor(), null, 'provider_sender_id', null, $summary + ['provider' => $provider->key()], $admin->ip, $admin->userAgent);

        return $summary;
    }

    public function add(AdminContext $admin, string $value, string $type, ?string $note): ProviderSenderId
    {
        $value = trim($value);
        $check = $this->providers->provider()->validateSenderId($value, $type);
        if (! $check['valid']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, $check['reason'] ?? 'Invalid sender ID.', ['field' => 'value']);
        }
        if (ProviderSenderId::query()->where('provider', $this->providerKey())->where('value', $value)->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'This sender ID is already in the catalog.', ['field' => 'value']);
        }
        $e = new ProviderSenderId;
        $e->forceFill(['provider' => $this->providerKey(), 'value' => $value, 'type' => $type, 'source' => 'MANUAL', 'active' => true,
            'note' => $note !== null ? mb_substr(trim($note), 0, 255) : null, 'createdById' => $admin->userId])->save();
        $this->audit->log('sender_catalog.add', $admin->actor(), null, 'provider_sender_id', $e->id, ['value' => $value, 'type' => $type], $admin->ip, $admin->userAgent);

        return $e;
    }

    public function update(AdminContext $admin, string $id, bool $active, ?string $note): ProviderSenderId
    {
        $e = ProviderSenderId::query()->findOrFail($id);
        $before = ['active' => $e->active, 'note' => $e->note];
        $e->forceFill(['active' => $active, 'note' => $note !== null ? mb_substr(trim($note), 0, 255) : $e->note])->save();
        $this->audit->log('sender_catalog.update', $admin->actor(), null, 'provider_sender_id', $id, ['before' => $before, 'after' => ['active' => $active, 'note' => $e->note]], $admin->ip, $admin->userAgent);

        return $e;
    }

    /**
     * Sets exactly which organizations may use this sender ID (multiple allowed). Idempotent.
     *
     * @param  list<string>  $organizationIds
     * @return array{assigned: list<string>, unassigned: list<string>}
     */
    public function assign(AdminContext $admin, string $id, array $organizationIds): array
    {
        $entry = ProviderSenderId::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Sender ID not found in the catalog.');
        $organizationIds = array_values(array_unique($organizationIds));
        if ($organizationIds && ! $entry->active) {
            throw new AppException(ErrorCode::CONFLICT, 'Activate this sender ID before assigning it.');
        }
        $found = Organization::query()->whereIn('id', $organizationIds)->pluck('id')->all();
        if (count($found) !== count($organizationIds)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'One or more customers were not found.', ['field' => 'organizationIds']);
        }
        $added = [];
        $removed = [];
        DB::transaction(function () use ($entry, $organizationIds, $admin, &$added, &$removed) {
            $now = now();
            foreach ($organizationIds as $orgId) {
                $s = SenderId::query()->where('organizationId', $orgId)->where('value', $entry->value)->lockForUpdate()->first();
                $hasDefault = SenderId::query()->where('organizationId', $orgId)->where('status', 'APPROVED')->where('isDefault', true)->where('value', '!=', $entry->value)->exists();
                // Already usable (catalog-assigned, or the customer's own approved request): leave it,
                // so unassigning the catalog entry never suspends a sender the customer got by itself.
                if ($s && $s->status->value === 'APPROVED') {
                    continue;
                }
                $data = ['type' => $entry->type->value, 'status' => 'APPROVED', 'providerRef' => $entry->id, 'rejectionReason' => null,
                    'reviewedById' => $admin->userId, 'reviewedAt' => $now, 'approvedAt' => $s?->approvedAt ?? $now, 'isDefault' => ($s?->isDefault ?? false) || ! $hasDefault];
                if ($s) {
                    $s->forceFill($data)->save();
                } else {
                    (new SenderId)->forceFill($data + ['organizationId' => $orgId, 'value' => $entry->value, 'purpose' => 'Assigned by the platform from the provider sender catalog', 'documents' => []])->save();
                }
                $added[] = $orgId;
            }
            $stale = SenderId::query()->where('providerRef', $entry->id)->where('status', 'APPROVED')->whereNotIn('organizationId', $organizationIds ?: ['-'])->lockForUpdate()->get();
            foreach ($stale as $s) {
                $s->forceFill(['status' => 'SUSPENDED', 'isDefault' => false, 'rejectionReason' => 'Unassigned by the platform', 'reviewedById' => $admin->userId, 'reviewedAt' => now()])->save();
                $removed[] = $s->organizationId;
            }
        });
        $this->audit->log('sender_catalog.assign', $admin->actor(), null, 'provider_sender_id', $id, ['value' => $entry->value, 'assigned' => $added, 'unassigned' => $removed, 'after' => $organizationIds], $admin->ip, $admin->userAgent);
        foreach ($added as $org) {
            $this->notifications->notify($org, 'sender_id.status', "Sender ID {$entry->value} is ready", 'You can now choose it when sending.', '/dashboard/sender-ids');
        }
        foreach ($removed as $org) {
            $this->notifications->notify($org, 'sender_id.status', "Sender ID {$entry->value} was removed", 'It can no longer be used for new messages.', '/dashboard/sender-ids');
        }

        return ['assigned' => $added, 'unassigned' => $removed];
    }
}
