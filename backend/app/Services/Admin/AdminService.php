<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Jobs\LaunchCampaignJob;
use App\Mail\EmailTemplates;
use App\Models\AbuseReport;
use App\Models\ApiKey;
use App\Models\ApiLog;
use App\Models\AuditLog;
use App\Models\Campaign;
use App\Models\ContactRequest;
use App\Models\Message;
use App\Models\Organization;
use App\Models\Payment;
use App\Models\PricingPlan;
use App\Models\SenderId;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\Payment\PaymentService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Services\Wallet\WalletService;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/** Platform staff operations (port of features/admin/service.ts + overview.ts). */
class AdminService
{
    public const PAGE_SIZE = 25;

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly WalletService $wallet,
        private readonly PaymentService $payments,
        private readonly NotificationService $notifications,
    ) {}

    // ─── Overview ───

    public function overview(): array
    {
        $now = now();
        $ts = fn ($d) => $d->format('Y-m-d H:i:s.v');
        $d30 = $now->copy()->subDays(30);
        $d1 = $now->copy()->subDay();
        $today = Dhaka::startOfDay();
        $revenue = Payment::query()->where('status', 'SUCCEEDED')->where('completedAt', '>=', $ts($d30))
            ->selectRaw('CAST(COALESCE(SUM(amount), 0) AS CHAR) AS amount, CAST(COALESCE(SUM(total), 0) AS CHAR) AS total')->first();
        $day = Dhaka::daySql('createdAt');
        $daily = collect(DB::select("SELECT {$day} AS day,
                COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered,
                COUNT(CASE WHEN status IN ('FAILED','REJECTED','EXPIRED','CANCELLED') THEN 1 END) AS failed,
                COUNT(CASE WHEN status IN ('QUEUED','SUBMITTED') THEN 1 END) AS pending
            FROM messages WHERE createdAt >= ? GROUP BY 1 ORDER BY 1", [$ts($d30)]))->keyBy('day');
        $cday = Dhaka::daySql('completedAt');
        $rev = collect(DB::select("SELECT {$cday} AS day, CAST(SUM(amount) AS CHAR) AS amount FROM payments WHERE status = 'SUCCEEDED' AND completedAt >= ? GROUP BY 1 ORDER BY 1", [$ts($d30)]))->keyBy('day');
        $series = [];
        for ($t = Dhaka::startOfDay($now->toImmutable()->subDays(29)); $t <= $now; $t = $t->addDay()) {
            $k = Dhaka::dateKey($t);
            $series[] = ['day' => $k, 'delivered' => (int) ($daily[$k]->delivered ?? 0), 'failed' => (int) ($daily[$k]->failed ?? 0), 'pending' => (int) ($daily[$k]->pending ?? 0), 'spend' => Money::round($rev[$k]->amount ?? '0', 2)];
        }

        return [
            'users' => User::query()->count(),
            'activeUsers' => User::query()->where('lastLoginAt', '>=', $ts($d30))->count(),
            'orgs' => Organization::query()->count(),
            'suspendedOrgs' => Organization::query()->where('status', 'SUSPENDED')->count(),
            'smsToday' => Message::query()->where('createdAt', '>=', $today->format('Y-m-d H:i:s.v'))->count(),
            'sms30' => Message::query()->where('createdAt', '>=', $ts($d30))->count(),
            'failed24' => Message::query()->where('failedAt', '>=', $ts($d1))->whereIn('status', ['FAILED', 'REJECTED', 'EXPIRED'])->count(),
            'revenue30' => Money::round($revenue->amount ?? '0', 2),
            'collected30' => Money::round($revenue->total ?? '0', 2),
            'pendingSenders' => SenderId::query()->where('status', 'PENDING')->count(),
            'pendingPayments' => Payment::query()->where('status', 'AWAITING_VERIFICATION')->count(),
            'reviewCampaigns' => Campaign::query()->where('status', 'PENDING_REVIEW')->count(),
            'openTickets' => SupportTicket::query()->whereIn('status', ['OPEN', 'IN_PROGRESS'])->count(),
            'newAbuse' => AbuseReport::query()->where('status', 'NEW')->count(),
            'api24' => ApiLog::query()->where('createdAt', '>=', $ts($d1))->count(),
            'newLeads' => ContactRequest::query()->where('status', 'NEW')->count(),
            'series' => $series,
        ];
    }

    // ─── Customers ───

    /**
     * q matches the organization name or ID, a member's e-mail, name or (normalised) phone.
     *
     * @param  array{q?: ?string, status?: ?string, planId?: ?string, from?: ?string, to?: ?string, review?: ?bool}  $f
     */
    public function organizations(array $f, int $page, string $sort = 'newest'): LengthAwarePaginator
    {
        $like = fn (string $s) => '%'.addcslashes($s, '%_\\').'%';
        $q = isset($f['q']) ? trim((string) $f['q']) : '';
        $phone = $q !== '' ? Phone::normalize($q) : null;
        $query = Organization::query()
            ->when($f['status'] ?? null, fn ($w, $s) => $w->where('organizations.status', $s))
            ->when($f['planId'] ?? null, fn ($w, $p) => $p === 'none' ? $w->whereNull('organizations.pricingPlanId') : $w->where('organizations.pricingPlanId', $p))
            ->when($f['review'] ?? null, fn ($w) => $w->where('organizations.requireCampaignReview', true))
            ->when($f['from'] ?? null, fn ($w, $d) => $w->where('organizations.createdAt', '>=', $d))
            ->when($f['to'] ?? null, fn ($w, $d) => $w->where('organizations.createdAt', '<', $d))
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('organizations.name', 'like', $like($q))
                ->orWhere('organizations.id', $q)
                ->orWhereHas('members.user', fn ($u) => $u->where(fn ($m) => $m->where('email', 'like', $like(strtolower($q)))->orWhere('name', 'like', $like($q))
                    ->when($phone, fn ($ph) => $ph->orWhere('phone', $phone))))))
            ->with(['wallet:id,organizationId,balance', 'pricingPlan:id,name'])
            ->withCount(['members', 'messages']);
        if ($sort === 'balance') {
            $query->leftJoin('wallets', 'wallets.organizationId', '=', 'organizations.id')->orderByDesc('wallets.balance')->select('organizations.*');
        } else {
            $query->orderByDesc('organizations.createdAt');
        }

        return $query->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    public function organizationDetail(string $id): array
    {
        $org = Organization::query()->with([
            'wallet', 'pricingPlan',
            'members' => fn ($q) => $q->with(['user' => fn ($u) => $u->withTrashed()->select(['id', 'name', 'email', 'lastLoginAt', 'status', 'emailVerifiedAt', 'phoneVerifiedAt']), 'role:id,name']),
            'senderIds' => fn ($q) => $q->orderByDesc('createdAt'),
        ])->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Organization not found.');
        $since = now()->subDays(30)->format('Y-m-d H:i:s.v');

        return [
            'organization' => $org,
            'campaigns' => Campaign::query()->where('organizationId', $id)->orderByDesc('createdAt')->limit(8)->get(),
            'payments' => Payment::query()->where('organizationId', $id)->orderByDesc('createdAt')->limit(8)->get(),
            'transactions' => WalletTransaction::query()->where('organizationId', $id)->orderByDesc('createdAt')->limit(10)->get(),
            'sent30' => Message::query()->where('organizationId', $id)->where('createdAt', '>=', $since)->count(),
            'failed30' => Message::query()->where('organizationId', $id)->where('createdAt', '>=', $since)->whereIn('status', ['FAILED', 'REJECTED', 'EXPIRED'])->count(),
            'audits' => AuditLog::query()->with('actor:id,name')->where('organizationId', $id)->orderByDesc('createdAt')->limit(15)->get(),
            // Key metadata only: the hash is never selected.
            'apiKeys' => ApiKey::query()->where('organizationId', $id)->orderByDesc('createdAt')->limit(20)
                ->get(['id', 'name', 'prefix', 'scopes', 'status', 'lastUsedAt', 'expiresAt', 'revokedAt', 'createdAt']),
            'tickets' => SupportTicket::query()->where('organizationId', $id)->orderByDesc('createdAt')->limit(10)
                ->get(['id', 'number', 'subject', 'status', 'priority', 'createdAt', 'lastReplyAt']),
            'statusTotals30' => Message::query()->where('organizationId', $id)->where('createdAt', '>=', $since)
                ->selectRaw('status, COUNT(*) AS count, CAST(COALESCE(SUM(cost), 0) AS CHAR) AS cost')->groupBy('status')->get()
                ->mapWithKeys(fn ($r) => [$r->status->value => ['count' => (int) $r->count, 'cost' => Money::round((string) $r->cost, 2)]]),
            'verification' => $org->members->map(fn ($m) => [
                'userId' => $m->userId, 'emailVerified' => (bool) $m->user?->emailVerifiedAt, 'phoneVerified' => (bool) $m->user?->phoneVerifiedAt,
            ])->values(),
            'planHistory' => AuditLog::query()->with('actor:id,name')->where('organizationId', $id)->where('action', 'admin.organization.controls_update')
                ->orderByDesc('createdAt')->limit(20)->get()
                ->filter(fn ($a) => ($a->metadata['before']['plan'] ?? null) !== ($a->metadata['after']['pricingPlanId'] ?? null))->values(),
        ];
    }

    /** @param array{dailySendLimit: int, monthlySendLimit: int, requireCampaignReview: bool, pricingPlanId: ?string} $input */
    public function updateControls(AdminContext $admin, string $id, array $input): void
    {
        $before = Organization::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Organization not found.');
        if ($input['monthlySendLimit'] < $input['dailySendLimit']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The monthly limit must be at least the daily limit.', ['field' => 'monthlySendLimit']);
        }
        $snapshot = ['daily' => $before->dailySendLimit, 'monthly' => $before->monthlySendLimit, 'review' => $before->requireCampaignReview, 'plan' => $before->pricingPlanId];
        $planKey = $input['pricingPlanId'] ? PricingPlan::query()->whereKey($input['pricingPlanId'])->value('key') : null;
        if ($input['pricingPlanId'] && ($planKey === null || (CustomerPricingService::isPrivateKey($planKey) && $planKey !== CustomerPricingService::KEY_PREFIX.$id))) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Pricing plan not found.', ['field' => 'pricingPlanId']);
        }
        $before->forceFill($input)->save();
        $this->audit->log('admin.organization.controls_update', $admin->actor(), $id, 'organization', $id, ['before' => $snapshot, 'after' => $input], $admin->ip);
    }

    public function setOrganizationStatus(AdminContext $admin, string $id, string $status, ?string $reason): void
    {
        $org = Organization::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Organization not found.');
        if (! $reason) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, $status === 'SUSPENDED' ? 'Give a reason for the suspension.' : 'Give a reason for reactivating the account.', ['field' => 'reason']);
        }
        if ($org->status->value === $status) {
            throw new AppException(ErrorCode::CONFLICT, $status === 'SUSPENDED' ? 'The account is already suspended.' : 'The account is already active.');
        }
        $before = $org->status->value;
        DB::transaction(function () use ($org, $status, $reason, $id, $admin, $before) {
            $org->forceFill(['status' => $status, 'suspendedReason' => $status === 'SUSPENDED' ? $reason : null])->save();
            if ($status === 'SUSPENDED') {
                // Nothing scheduled may start; queued messages are held by the dispatcher (org not ACTIVE).
                // API keys stay but are rejected while the organization is suspended.
                Campaign::query()->where('organizationId', $id)->whereIn('status', ['SCHEDULED', 'PROCESSING'])->update(['status' => 'PAUSED', 'pausedAt' => now()->format('Y-m-d H:i:s.v')]);
            }
            $this->audit->log($status === 'SUSPENDED' ? 'admin.organization.suspend' : 'admin.organization.activate', $admin->actor(), $id, 'organization', $id, ['reason' => $reason, 'before' => $before, 'after' => $status], $admin->ip, $admin->userAgent);
        });
    }

    // ─── Campaign review ───

    public function campaigns(?string $status, int $page): LengthAwarePaginator
    {
        return Campaign::query()->when($status, fn ($q, $s) => $q->where('status', $s))
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name', 'createdAt'])])
            ->orderBy('createdAt', $status === 'PENDING_REVIEW' ? 'asc' : 'desc')
            ->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    public function reviewCampaign(AdminContext $admin, string $id, string $decision, ?string $reason): Campaign
    {
        $c = Campaign::query()->whereKey($id)->where('status', 'PENDING_REVIEW')->first()
            ?? throw new AppException(ErrorCode::CONFLICT, 'This campaign is not waiting for review.');
        if ($decision === 'reject' && ! $reason) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Give the customer a reason.', ['field' => 'reason']);
        }
        $scheduledAt = $c->scheduledAt && $c->scheduledAt->isFuture() ? $c->scheduledAt : null;
        $data = $decision === 'approve'
            ? ['status' => 'SCHEDULED', 'scheduledAt' => $scheduledAt, 'reviewedAt' => now(), 'reviewedById' => $admin->userId]
            : ['status' => 'CANCELLED', 'cancelledAt' => now(), 'reviewedAt' => now(), 'reviewedById' => $admin->userId, 'reviewNote' => $reason];
        // Conditional on PENDING_REVIEW so two reviewers cannot both act.
        if (! Campaign::query()->whereKey($id)->where('status', 'PENDING_REVIEW')->update(array_map(fn ($v) => $v instanceof \DateTimeInterface ? $v->format('Y-m-d H:i:s.v') : $v, $data))) {
            throw new AppException(ErrorCode::CONFLICT, 'This campaign is not waiting for review.');
        }
        $this->audit->log($decision === 'approve' ? 'campaign.approve' : 'campaign.reject', $admin->actor(), $c->organizationId, 'campaign', $id, ['reason' => $reason], $admin->ip);
        $this->notifications->notify(
            $c->organizationId,
            'campaign.review',
            $decision === 'approve' ? "Campaign \"{$c->name}\" approved" : "Campaign \"{$c->name}\" was not approved",
            $decision === 'approve' ? ($scheduledAt ? 'It will send at '.Dhaka::formatDateTime($scheduledAt->toImmutable()).'.' : 'Sending is starting now.') : "Reason: {$reason}",
            "/dashboard/campaigns/{$id}",
        );
        if ($decision === 'approve' && ! $scheduledAt) {
            LaunchCampaignJob::dispatch($id);
        }

        return $c->refresh();
    }

    // ─── Sender IDs ───

    public function senderIds(?string $status, int $page): LengthAwarePaginator
    {
        return SenderId::query()->when($status, fn ($q, $s) => $q->where('status', $s))
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name', 'pricingPlanId'])->with('pricingPlan:id,senderIdFee')])
            ->orderBy($status === 'PENDING' ? 'createdAt' : 'updatedAt', $status === 'PENDING' ? 'asc' : 'desc')
            ->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    public function reviewSenderId(AdminContext $admin, string $id, string $decision, ?string $reason, ?string $providerRef): SenderId
    {
        $s = SenderId::query()->with(['organization' => fn ($q) => $q->withTrashed()->with('pricingPlan')])->find($id)
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Sender ID not found.');
        if ($decision !== 'APPROVED' && ! $reason) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Give the customer a reason.', ['field' => 'reason']);
        }
        if ($decision === 'APPROVED' && ! in_array($s->status->value, ['PENDING', 'SUSPENDED'], true)) {
            throw new AppException(ErrorCode::CONFLICT, 'Only pending or suspended sender IDs can be approved.');
        }
        DB::transaction(function () use ($s, $decision, $reason, $providerRef, $admin, $id) {
            $locked = SenderId::query()->lockForUpdate()->findOrFail($id, ['id', 'status']);
            $fee = $s->organization?->pricingPlan?->senderIdFee;
            // The fee is charged once, on first approval (ledger key (SENDER_ID_FEE, sender_id, id) is unique).
            if ($decision === 'APPROVED' && $locked->status->value === 'PENDING' && $fee !== null && Money::isPositive((string) $fee)) {
                $this->wallet->debit(['organizationId' => $s->organizationId, 'amount' => (string) $fee, 'reason' => 'SENDER_ID_FEE', 'description' => "Sender ID fee: {$s->value}", 'referenceType' => 'sender_id', 'referenceId' => $s->id, 'createdById' => $admin->userId]);
            }
            $hasDefault = SenderId::query()->where('organizationId', $s->organizationId)->where('status', 'APPROVED')->where('isDefault', true)->where('id', '!=', $s->id)->exists();
            $s->forceFill(['status' => $decision, 'rejectionReason' => $decision === 'APPROVED' ? null : $reason, 'reviewedAt' => now(), 'reviewedById' => $admin->userId]
                + ($decision === 'APPROVED' ? ['approvedAt' => $s->approvedAt ?? now(), 'providerRef' => $providerRef ?? $s->providerRef, 'isDefault' => $s->isDefault || ! $hasDefault] : ['isDefault' => false]))->save();
            $this->audit->log('admin.sender_id.'.strtolower($decision), $admin->actor(), $s->organizationId, 'sender_id', $id, ['value' => $s->value, 'reason' => $reason], $admin->ip);
        });
        $title = match ($decision) {
            'APPROVED' => "Sender ID {$s->value} approved",
            'REJECTED' => "Sender ID {$s->value} was not approved",
            default => "Sender ID {$s->value} suspended",
        };
        $this->notifications->notify($s->organizationId, 'sender_id.status', $title, $decision === 'APPROVED' ? 'You can now use it when sending.' : "Reason: {$reason}", '/dashboard/sender-ids',
            email: fn () => EmailTemplates::senderIdStatus($s->value, $decision, $reason));

        return $s->refresh();
    }

    // ─── Payments ───

    public function payments(?string $status, int $page): LengthAwarePaginator
    {
        return Payment::query()->when($status, fn ($q, $s) => $q->where('status', $s))
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name']), 'invoice:id,paymentId,number'])
            ->orderByDesc('createdAt')->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    public function reviewManualPayment(AdminContext $admin, string $id, string $decision, ?string $reason): Payment
    {
        $p = Payment::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Payment not found.');
        if ($p->provider !== 'manual') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Only manual payments are verified here.');
        }
        if ($decision === 'approve') {
            $this->payments->complete($id, $admin->actor(), $p->manualReference ? "MANUAL-{$p->manualReference}" : null, null, $reason ?? 'verified by admin');
        } else {
            if (! $reason) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Give the customer a reason.', ['field' => 'reason']);
            }
            if (! $this->payments->fail($id, $reason, $admin->actor())) {
                throw new AppException(ErrorCode::CONFLICT, 'This payment is no longer pending.');
            }
        }

        return $p->refresh();
    }

    // ─── Support ───

    public function tickets(?string $status, ?string $assignedToId, int $page): LengthAwarePaginator
    {
        return SupportTicket::query()
            ->when($status, fn ($q, $s) => $q->where('status', $s), fn ($q) => $q->where('status', '!=', 'CLOSED'))
            ->when($assignedToId, fn ($q, $a) => $q->where('assignedToId', $a))
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name']), 'assignedTo:id,name', 'createdBy' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->orderByRaw("FIELD(priority, 'URGENT', 'HIGH', 'NORMAL', 'LOW')")->orderBy('lastReplyAt')
            ->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    public function ticket(string $id): SupportTicket
    {
        return SupportTicket::query()->with([
            'organization' => fn ($q) => $q->withTrashed()->select(['id', 'name']),
            'createdBy' => fn ($q) => $q->withTrashed()->select(['id', 'name', 'email']),
            'assignedTo:id,name',
            'messages' => fn ($q) => $q->orderBy('createdAt')->with(['author' => fn ($a) => $a->withTrashed()->select(['id', 'name'])]),
        ])->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Ticket not found.');
    }

    public function staffReply(AdminContext $admin, string $id, string $body, bool $internal, ?string $status): void
    {
        $t = SupportTicket::query()->with(['createdBy' => fn ($q) => $q->withTrashed()->select(['id', 'email'])])->find($id)
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Ticket not found.');
        $status ??= $internal ? $t->status->value : 'WAITING_FOR_CUSTOMER';
        DB::transaction(function () use ($t, $admin, $body, $internal, $status) {
            SupportMessage::query()->forceCreate(['ticketId' => $t->id, 'authorId' => $admin->userId, 'body' => $body, 'isStaff' => true, 'isInternal' => $internal]);
            $t->forceFill(['status' => $status, 'assignedToId' => $t->assignedToId ?? $admin->userId] + ($internal ? [] : ['lastReplyAt' => now()]) + ($status === 'CLOSED' ? ['closedAt' => now()] : []))->save();
        });
        $this->audit->log($internal ? 'admin.support.note' : 'admin.support.reply', $admin->actor(), $t->organizationId, 'ticket', $id, ['status' => $status], $admin->ip);
        if (! $internal && $t->createdBy) {
            $label = strtolower(str_replace('_', ' ', $status));
            $this->notifications->notify($t->organizationId, 'support.updated', "Reply on ticket #{$t->number}", mb_substr($body, 0, 140), "/dashboard/support/{$id}", [$t->createdBy->id],
                fn () => EmailTemplates::supportTicketUpdate($t->number, $t->subject, $label, mb_substr($body, 0, 500), $id));
        }
    }

    public function setTicketStatus(AdminContext $admin, string $id, string $status, bool $assignToMe): void
    {
        $t = SupportTicket::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Ticket not found.');
        $t->forceFill(['status' => $status] + ($assignToMe ? ['assignedToId' => $admin->userId] : []) + ($status === 'CLOSED' ? ['closedAt' => now()] : []))->save();
        $this->audit->log('admin.support.status', $admin->actor(), $t->organizationId, 'ticket', $id, ['status' => $status, 'assignToMe' => $assignToMe]);
    }

    // ─── Users (platform) ───

    public function users(?string $q, ?string $role, int $page): LengthAwarePaginator
    {
        return User::query()
            ->when($role, fn ($w, $r) => $w->where('platformRole', $r))
            ->when($q, fn ($w, $s) => $w->where(fn ($x) => $x->where('email', 'like', '%'.addcslashes(strtolower($s), '%_\\').'%')->orWhere('name', 'like', '%'.addcslashes($s, '%_\\').'%')))
            ->with(['memberships' => fn ($m) => $m->with(['organization' => fn ($o) => $o->withTrashed()->select(['id', 'name'])])])
            ->orderByDesc('createdAt')->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    // ─── Abuse reports & leads ───

    public function abuseReports(?string $status, int $page): LengthAwarePaginator
    {
        return AbuseReport::query()->when($status, fn ($q, $s) => $q->where('status', $s))->orderBy('status')->orderByDesc('createdAt')->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    public function setAbuseStatus(AdminContext $admin, string $id, string $status, ?string $note): void
    {
        $r = AbuseReport::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Report not found.');
        $r->forceFill(['status' => $status, 'resolutionNote' => $note, 'handledById' => $admin->userId])->save();
        $this->audit->log('admin.abuse.update', $admin->actor(), $r->organizationId, 'abuse_report', $id, ['status' => $status]);
    }

    public function leads(?string $status, int $page): LengthAwarePaginator
    {
        return ContactRequest::query()->when($status, fn ($q, $s) => $q->where('status', $s))->orderByDesc('createdAt')->paginate(self::PAGE_SIZE, ['*'], 'page', $page);
    }

    public function setLeadStatus(AdminContext $admin, string $id, string $status): void
    {
        $r = ContactRequest::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Lead not found.');
        $r->forceFill(['status' => $status])->save();
        $this->audit->log('admin.lead.update', $admin->actor(), null, 'contact_request', $id, ['status' => $status]);
    }

    // ─── Logs ───

    public function messages(array $f, int $page): LengthAwarePaginator
    {
        return Message::query()
            ->when($f['organizationId'] ?? null, fn ($q, $v) => $q->where('organizationId', $v))
            ->when($f['status'] ?? null, fn ($q, $v) => $q->where('status', $v))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('to', $v))
            ->when($f['campaignId'] ?? null, fn ($q, $v) => $q->where('campaignId', $v))
            ->when($f['provider'] ?? null, fn ($q, $v) => $q->where('providerMessageId', $v))
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->orderByDesc('createdAt')
            ->paginate(self::PAGE_SIZE, ['id', 'organizationId', 'campaignId', 'to', 'status', 'senderValue', 'smsType', 'source', 'segments', 'cost', 'provider', 'providerMessageId', 'errorCode', 'errorMessage', 'createdAt'], 'page', $page);
    }

    public function auditLogs(array $f, int $page): LengthAwarePaginator
    {
        return AuditLog::query()
            ->when($f['organizationId'] ?? null, fn ($q, $v) => $q->where('organizationId', $v))
            ->when($f['action'] ?? null, fn ($q, $v) => $q->where('action', 'like', addcslashes($v, '%_\\').'%'))
            ->with(['actor:id,name,email', 'organization' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->orderByDesc('createdAt')->paginate(50, ['*'], 'page', $page);
    }

    public function apiLogs(array $f, int $page): LengthAwarePaginator
    {
        return ApiLog::query()
            ->when($f['organizationId'] ?? null, fn ($q, $v) => $q->where('organizationId', $v))
            ->when(($f['status'] ?? null) === '4xx', fn ($q) => $q->whereBetween('statusCode', [400, 499]))
            ->when(($f['status'] ?? null) === '5xx', fn ($q) => $q->where('statusCode', '>=', 500))
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name']), 'apiKey:id,name,prefix'])
            ->orderByDesc('createdAt')->paginate(50, ['*'], 'page', $page);
    }
}
