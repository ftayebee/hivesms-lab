<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Admin\PaymentRefundRequest;
use App\Http\Requests\Admin\ProviderCostRequest;
use App\Http\Requests\Admin\WalletAdjustRequest;
use App\Http\Resources\AuditLogResource;
use App\Http\Resources\PaymentResource;
use App\Http\Resources\TransactionResource;
use App\Models\AuditLog;
use App\Services\Admin\FinanceService;
use App\Services\Admin\PlatformDashboardService;
use App\Services\Admin\PrivilegedActionGuard;
use App\Services\Platform\ReadinessService;
use App\Support\DateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super Admin finance and platform views. Route permissions (routes/api.php) are the authorization;
 * money-moving endpoints additionally re-confirm the staff member's password.
 */
class AdminFinanceController extends ApiController
{
    public function __construct(private readonly FinanceService $finance, private readonly PrivilegedActionGuard $guard) {}

    private function range(Request $request): DateRange
    {
        $request->validate(['range' => ['nullable', 'in:today,7d,30d,90d,custom'], 'from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d']]);

        return DateRange::fromQuery($request->query(), '30d');
    }

    /** GET /admin/dashboard?range=&from=&to= (admin:access; finance and privileged actions only for roles allowed to see them). */
    public function dashboard(Request $request, PlatformDashboardService $dashboard): JsonResponse
    {
        $d = $dashboard->dashboard($this->admin($request), $this->range($request));
        if ($d['recentPrivilegedActions'] !== null) {
            $d['recentPrivilegedActions'] = AuditLogResource::collection($d['recentPrivilegedActions'])->resolve($request);
        }

        return $this->ok($d);
    }

    /** GET /admin/finance/summary?range=&from=&to= (admin:finance:read). */
    public function summary(Request $request): JsonResponse
    {
        return $this->ok($this->finance->summary($this->range($request)));
    }

    /** GET /admin/finance/transactions?range=&organizationId=&reason=&type=&page= (admin:finance:read). */
    public function transactions(Request $request): JsonResponse
    {
        $f = $request->validate([
            'organizationId' => ['nullable', 'uuid'], 'reason' => ['nullable', 'in:TOPUP,BONUS,SMS_CHARGE,REFUND,ADJUSTMENT,SENDER_ID_FEE'], 'type' => ['nullable', 'in:CREDIT,DEBIT'],
        ]);

        return $this->paginated($request, $this->finance->ledger($this->range($request), $f, $this->page($request)), TransactionResource::class);
    }

    /** POST /admin/customers/{id}/wallet-adjustments (admin:wallet:adjust + password; idempotent). */
    public function adjustWallet(WalletAdjustRequest $request, string $id): JsonResponse
    {
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $request->input('currentPassword'));
        $r = $this->finance->adjust($admin, $id, $request->input('direction'), (string) $request->input('amount'), trim((string) $request->input('reason')), (string) $request->input('idempotencyKey'));

        return $this->ok(['message' => $r['replayed'] ? 'This adjustment was already applied.' : 'Wallet adjusted.', 'transaction' => (new TransactionResource($r['transaction']))->resolve($request), 'replayed' => $r['replayed']], $r['replayed'] ? 200 : 201);
    }

    /** POST /admin/payments/{id}/refund {reason, currentPassword} (admin:payments:refund). */
    public function refund(PaymentRefundRequest $request, string $id): JsonResponse
    {
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $request->input('currentPassword'));

        return $this->resource($request, PaymentResource::class, $this->finance->refundPayment($admin, $id, trim((string) $request->input('reason'))));
    }

    /** GET /admin/finance/provider-costs (admin:finance:read): configured rates + change history. */
    public function providerCosts(Request $request): JsonResponse
    {
        $history = AuditLog::query()->where('action', 'pricing.provider_costs.update')->with('actor:id,name')->orderByDesc('createdAt')->limit(20)->get();

        return $this->ok(['current' => $this->finance->providerCosts(), 'history' => AuditLogResource::collection($history)->resolve($request)]);
    }

    /** PUT /admin/finance/provider-costs (admin:costs:manage + password). Never changes the sending provider. */
    public function saveProviderCosts(ProviderCostRequest $request): JsonResponse
    {
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $request->input('currentPassword'));

        return $this->ok($this->finance->saveProviderCosts($admin, $request->only(['provider', 'rates', 'effectiveFrom', 'source']), trim((string) $request->input('reason'))));
    }

    /** GET /admin/finance/margins?range=&groupBy=organization|plan|campaign|day&page= (admin:finance:read). Estimates only. */
    public function margins(Request $request): JsonResponse
    {
        $g = $request->validate(['groupBy' => ['nullable', 'in:organization,plan,campaign,day']]);
        $range = $this->range($request);
        $r = $this->finance->margins($range, $g['groupBy'] ?? 'organization', $this->page($request));

        return $this->ok($r['rows'], 200, ['page' => $this->page($request), 'pageSize' => 50, 'total' => $r['total'], 'totalPages' => (int) max(1, ceil($r['total'] / 50)),
            'basis' => $r['basis'], 'totals' => $this->finance->marginTotals($range), 'range' => $range->toArray()]);
    }

    /** GET /admin/system/health (admin:health:read): ok/fail per check only. */
    public function health(ReadinessService $readiness): JsonResponse
    {
        return $this->ok($readiness->run() + ['environment' => app()->isProduction() ? 'production' : 'non-production']);
    }
}
