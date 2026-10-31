<?php

namespace App\Http\Controllers\Api\V1\Reports;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Resources\CampaignResource;
use App\Http\Resources\TransactionResource;
use App\Models\Campaign;
use App\Models\WalletTransaction;
use App\Services\Report\ReportService;
use App\Services\Wallet\BillingService;
use App\Support\DateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /app/dashboard?range=today|7d|30d|90d|custom&from=&to= — exactly what the dashboard page
 * renders (port of app/dashboard/page.tsx data loading): all aggregates computed in SQL, about
 * eight cheap queries in total, billing figures only for members with billing:read.
 */
class DashboardController extends ApiController
{
    public function __invoke(Request $request, ReportService $reports, BillingService $billing): JsonResponse
    {
        $ctx = $this->tenant($request);
        $range = DateRange::fromQuery($request->query(), '30d');
        $canBilling = $ctx->can('billing:read');

        $recent = Campaign::query()->where('organizationId', $ctx->organizationId)->orderByDesc('createdAt')->limit(5)
            ->get(['id', 'name', 'status', 'recipientCount', 'deliveredCount', 'failedCount', 'submittedCount', 'scheduledAt', 'createdAt', 'smsType']);

        return $this->ok([
            'range' => $range->toArray(),
            'totals' => $reports->statusTotals($ctx, $range),
            'daily' => $reports->dailySeries($ctx, $range),
            'spend' => $canBilling ? $reports->spend($ctx, $range) : null,
            'balance' => $canBilling ? $billing->summary($ctx) : null,
            'recentCampaigns' => CampaignResource::collection($recent)->resolve($request),
            'campaignPerformance' => $reports->campaignPerformance($ctx, $range, 6),
            'recentTransactions' => $canBilling
                ? TransactionResource::collection(WalletTransaction::query()->where('organizationId', $ctx->organizationId)->orderByDesc('createdAt')->limit(5)->get())->resolve($request)
                : [],
        ]);
    }
}
