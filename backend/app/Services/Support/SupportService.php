<?php

namespace App\Services\Support;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Services\Platform\AuditLogger;
use App\Support\ErrorCode;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/** Customer support tickets (port of features/support/service.ts). Internal staff notes are never returned. */
class SupportService
{
    public const CATEGORIES = ['General', 'Billing', 'Sender ID', 'Delivery', 'API / integration', 'Account', 'Abuse / compliance'];

    public function __construct(private readonly AuditLogger $audit) {}

    public function list(TenantContext $ctx, ?string $status, int $page): LengthAwarePaginator
    {
        $ctx->requirePermission('support:read');

        return SupportTicket::query()->where('organizationId', $ctx->organizationId)
            ->when($status, fn ($q, $s) => $q->where('status', $s))
            ->with(['createdBy' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->withCount(['messages' => fn ($q) => $q->where('isInternal', false)])
            ->orderByDesc('lastReplyAt')
            ->paginate(20, ['*'], 'page', $page);
    }

    /** @param array{subject: string, category: string, priority: string, message: string} $input */
    public function create(TenantContext $ctx, array $input): SupportTicket
    {
        $ctx->requirePermission('support:write');
        $open = SupportTicket::query()->where('organizationId', $ctx->organizationId)->whereIn('status', ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER'])->count();
        if ($open >= 30) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'You have many open tickets. Reply on an existing ticket or close resolved ones.');
        }
        $t = DB::transaction(function () use ($ctx, $input) {
            $t = SupportTicket::query()->forceCreate([
                'organizationId' => $ctx->organizationId, 'subject' => $input['subject'], 'category' => $input['category'],
                'priority' => $input['priority'], 'createdById' => $ctx->userId, 'lastReplyAt' => now(),
            ]);
            SupportMessage::query()->forceCreate(['ticketId' => $t->id, 'authorId' => $ctx->userId, 'body' => $input['message']]);

            return $t->refresh();
        });
        $this->audit->log('support.create', $ctx->actor(), $ctx->organizationId, 'ticket', $t->id, ['number' => $t->number, 'priority' => $input['priority']]);

        return $t;
    }

    public function find(TenantContext $ctx, string $id): SupportTicket
    {
        $ctx->requirePermission('support:read');

        return SupportTicket::query()->where('organizationId', $ctx->organizationId)->whereKey($id)
            ->with([
                'createdBy' => fn ($q) => $q->withTrashed()->select(['id', 'name']),
                'messages' => fn ($q) => $q->where('isInternal', false)->orderBy('createdAt')->with(['author' => fn ($a) => $a->withTrashed()->select(['id', 'name'])]),
            ])->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Ticket not found.');
    }

    public function reply(TenantContext $ctx, string $id, string $body): SupportMessage
    {
        $ctx->requirePermission('support:write');
        $t = SupportTicket::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Ticket not found.');
        if ($t->status->value === 'CLOSED') {
            throw new AppException(ErrorCode::CONFLICT, 'This ticket is closed. Open a new ticket and reference this one.');
        }
        $msg = DB::transaction(function () use ($ctx, $t, $body) {
            $m = SupportMessage::query()->forceCreate(['ticketId' => $t->id, 'authorId' => $ctx->userId, 'body' => $body]);
            $t->forceFill(['lastReplyAt' => now(), 'status' => in_array($t->status->value, ['WAITING_FOR_CUSTOMER', 'RESOLVED'], true) ? 'OPEN' : $t->status->value])->save();

            return $m;
        });
        $this->audit->log('support.reply', $ctx->actor(), $ctx->organizationId, 'ticket', $id);

        return $msg->load(['author' => fn ($a) => $a->select(['id', 'name'])]);
    }

    public function close(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('support:write');
        $n = SupportTicket::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->where('status', '!=', 'CLOSED')
            ->update(['status' => 'CLOSED', 'closedAt' => now()->format('Y-m-d H:i:s.v')]);
        if (! $n) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Ticket not found.');
        }
        $this->audit->log('support.close', $ctx->actor(), $ctx->organizationId, 'ticket', $id);
    }
}
