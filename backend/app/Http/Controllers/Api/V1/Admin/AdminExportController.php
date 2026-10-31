<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Auth\Permissions;
use App\Exceptions\AppException;
use App\Http\Controllers\Api\V1\ApiController;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\Payment;
use App\Services\Admin\FinanceService;
use App\Services\Platform\AuditLogger;
use App\Support\Csv;
use App\Support\DateRange;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * GET /admin/exports/{kind}?range=&from=&to= — CSV exports for platform staff.
 * Authorization: route permission `admin:reports:export` AND the read permission of the data
 * (below). Data minimisation: no passwords, hashes, API keys, IP addresses, e-mail addresses,
 * phone numbers or message bodies; cells are CSV-injection safe (Csv::line). Each export is audited.
 * Downloads are streamed through the Next.js BFF with the staff session (no public URL).
 */
class AdminExportController extends ApiController
{
    private const KINDS = [
        'customers' => 'admin:customers:read',
        'payments' => 'admin:billing:read',
        'transactions' => 'admin:finance:read',
        'margins' => 'admin:finance:read',
        'audit-logs' => 'admin:audit:read',
    ];

    private const MAX_ROWS = 100000;

    public function export(Request $request, string $kind, FinanceService $finance, AuditLogger $audit): StreamedResponse
    {
        $admin = $this->admin($request);
        $permission = self::KINDS[$kind] ?? throw new AppException(ErrorCode::NOT_FOUND, 'Unknown export.');
        if (! Permissions::platformCan($admin->role, $permission)) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Your staff role does not allow this export.');
        }
        $request->validate(['range' => ['nullable', 'in:today,7d,30d,90d,custom'], 'from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d']]);
        $range = DateRange::fromQuery($request->query(), '30d');
        [$from, $to] = [$range->from->format('Y-m-d H:i:s.v'), $range->to->format('Y-m-d H:i:s.v')];
        $audit->log('admin.export', $admin->actor(), null, 'export', $kind, ['range' => $range->toArray()], $admin->ip, $admin->userAgent);

        return $this->csv("admin-{$kind}", function (callable $write) use ($kind, $from, $to, $range, $finance) {
            $write(Csv::bom());
            $n = 0;
            $emit = function (array $cells) use ($write, &$n) {
                if ($n++ < self::MAX_ROWS) {
                    $write(Csv::line($cells));
                }
            };
            match ($kind) {
                'customers' => $this->customers($emit, $from, $to),
                'payments' => $this->payments($emit, $from, $to),
                'transactions' => $this->transactions($emit, $finance, $range),
                'margins' => $this->margins($emit, $finance, $range),
                'audit-logs' => $this->auditLogs($emit, $from, $to),
            };
        });
    }

    private function customers(callable $emit, string $from, string $to): void
    {
        $emit(['id', 'name', 'status', 'plan', 'balance_bdt', 'members', 'daily_limit', 'monthly_limit', 'review_required', 'created_at']);
        Organization::query()->where('createdAt', '>=', $from)->where('createdAt', '<', $to)
            ->with(['wallet:id,organizationId,balance', 'pricingPlan:id,name'])->withCount('members')
            ->orderBy('id')->chunkById(500, function ($rows) use ($emit) {
                foreach ($rows as $o) {
                    $emit([$o->id, $o->name, $o->status->value, $o->pricingPlan?->name ?? 'Default plan', Money::round($o->wallet ? (string) $o->wallet->balance : '0', 2),
                        $o->members_count, $o->dailySendLimit, $o->monthlySendLimit, $o->requireCampaignReview, Dhaka::iso($o->createdAt)]);
                }
            });
    }

    private function payments(callable $emit, string $from, string $to): void
    {
        $emit(['id', 'organization_id', 'organization', 'provider', 'status', 'amount_bdt', 'vat_bdt', 'total_bdt', 'credit_bdt', 'provider_ref', 'created_at', 'completed_at']);
        Payment::query()->where('createdAt', '>=', $from)->where('createdAt', '<', $to)
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->orderBy('id')->chunkById(500, function ($rows) use ($emit) {
                foreach ($rows as $p) {
                    $emit([$p->id, $p->organizationId, $p->organization?->name, $p->provider, $p->status->value, Money::plain((string) $p->amount), Money::plain((string) $p->vatAmount),
                        Money::plain((string) $p->total), Money::plain((string) $p->creditAmount), $p->providerRef, Dhaka::iso($p->createdAt), Dhaka::iso($p->completedAt)]);
                }
            });
    }

    private function transactions(callable $emit, FinanceService $finance, DateRange $range): void
    {
        $emit(['id', 'organization_id', 'type', 'reason', 'amount_bdt', 'balance_after_bdt', 'description', 'reference_type', 'reference_id', 'created_by_id', 'created_at']);
        $finance->ledgerQuery($range, [])->reorder()->orderBy('id')->chunkById(1000, function ($rows) use ($emit) {
            foreach ($rows as $t) {
                $emit([$t->id, $t->organizationId, $t->type->value, $t->reason->value, Money::plain((string) $t->amount), Money::plain((string) $t->balanceAfter),
                    $t->description, $t->referenceType, $t->referenceId, $t->createdById, Dhaka::iso($t->createdAt)]);
            }
        });
    }

    private function margins(callable $emit, FinanceService $finance, DateRange $range): void
    {
        $emit(['organization_id', 'organization', 'messages', 'billed_bdt', 'refunded_bdt', 'provider_segments', 'estimated_provider_cost_bdt', 'estimated_margin_bdt', 'basis']);
        for ($page = 1; $page <= 200; $page++) {
            $r = $finance->margins($range, 'organization', $page, 500);
            foreach ($r['rows'] as $row) {
                $emit([$row['key'], $row['label'], $row['messages'], $row['billed'], $row['refunded'], $row['providerSegments'], $row['estimatedCost'], $row['estimatedMargin'], $r['basis']]);
            }
            if (count($r['rows']) < 500) {
                break;
            }
        }
    }

    private function auditLogs(callable $emit, string $from, string $to): void
    {
        $emit(['id', 'created_at', 'action', 'actor_type', 'actor_user_id', 'organization_id', 'target_type', 'target_id', 'reason']);
        AuditLog::query()->where('createdAt', '>=', $from)->where('createdAt', '<', $to)->orderBy('id')
            ->chunkById(1000, function ($rows) use ($emit) {
                foreach ($rows as $a) {
                    $reason = $a->metadata['reason'] ?? null;
                    $emit([$a->id, Dhaka::iso($a->createdAt), $a->action, $a->actorType->value, $a->actorUserId, $a->organizationId, $a->targetType, $a->targetId, is_scalar($reason) ? (string) $reason : null]);
                }
            });
    }
}
