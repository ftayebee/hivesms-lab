<?php

namespace App\Http\Controllers\Api\V1\Reports;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Resources\CampaignResource;
use App\Http\Resources\MessageResource;
use App\Models\Campaign;
use App\Models\Message;
use App\Services\Report\ReportService;
use App\Support\DateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Reports and message history. Common query: range=today|7d|30d|90d|custom (&from&to, Dhaka days),
 * campaign, sender, status, recipient (or phone), source, page.
 */
class ReportController extends ApiController
{
    public function __construct(private readonly ReportService $reports) {}

    private function filters(Request $request): array
    {
        $request->validate([
            'range' => ['nullable', 'in:today,7d,30d,90d,custom'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'campaign' => ['nullable', 'uuid'],
            'sender' => ['nullable', 'string', 'max:20'],
            'status' => ['nullable', 'string', 'max:20'],
            'recipient' => ['nullable', 'string', 'max:30'],
            'phone' => ['nullable', 'string', 'max:30'],
            'source' => ['nullable', 'string', 'max:20'],
        ]);

        return ReportService::filters($request->query());
    }

    /** GET /app/reports/delivery: totals, daily series, operators, failure reasons. */
    public function delivery(Request $request): JsonResponse
    {
        $ctx = $this->tenant($request);
        $range = DateRange::fromQuery($request->query());
        $f = $this->filters($request);

        return $this->ok([
            'range' => $range->toArray(),
            'filters' => (object) $f,
            'totals' => $this->reports->statusTotals($ctx, $range, $f),
            'daily' => $this->reports->dailySeries($ctx, $range, $f),
            'operators' => $this->reports->operators($ctx, $range, $f),
            'failures' => $this->reports->failureReasons($ctx, $range, $f),
        ]);
    }

    /** GET /app/reports/filters: options for the report filter dropdowns (started campaigns, senders used). */
    public function filterOptions(Request $request): JsonResponse
    {
        $orgId = $this->tenant($request)->organizationId;

        return $this->ok([
            'campaigns' => Campaign::query()->where('organizationId', $orgId)->whereNotNull('startedAt')->orderByDesc('startedAt')->limit(100)->get(['id', 'name'])
                ->map(fn ($c) => ['id' => $c->id, 'name' => $c->name])->values(),
            'senders' => Message::query()->where('organizationId', $orgId)->distinct()->limit(50)->pluck('senderValue')->values(),
        ]);
    }

    /** GET /app/reports/usage: segments, spend (ledger: charges − refunds), daily spend. */
    public function usage(Request $request): JsonResponse
    {
        $ctx = $this->tenant($request);
        $ctx->requirePermission('billing:read');
        $range = DateRange::fromQuery($request->query());
        $totals = $this->reports->statusTotals($ctx, $range);

        return $this->ok([
            'range' => $range->toArray(),
            'messages' => $totals['total'],
            'segments' => $totals['segments'],
            'spend' => $this->reports->spend($ctx, $range),
            'daily' => array_map(fn ($d) => ['day' => $d['day'], 'spend' => $d['spend'], 'messages' => $d['delivered'] + $d['failed'] + $d['pending']], $this->reports->dailySeries($ctx, $range)),
        ]);
    }

    /** GET /app/reports/campaigns: per-campaign counters for campaigns created in the range. */
    public function campaigns(Request $request): JsonResponse
    {
        $range = DateRange::fromQuery($request->query());

        return $this->paginated($request, $this->reports->campaigns($this->tenant($request), $range, $this->page($request)), CampaignResource::class, ['range' => $range->toArray()]);
    }

    /** GET /app/reports/messages and /app/messages: paginated message log. */
    public function messages(Request $request): JsonResponse
    {
        $range = DateRange::fromQuery($request->query());

        return $this->paginated($request, $this->reports->messages($this->tenant($request), $range, $this->filters($request), $this->page($request)), MessageResource::class, ['range' => $range->toArray()]);
    }

    /** GET /app/messages/{id}: one message with its event history. */
    public function message(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, MessageResource::class, $this->reports->message($this->tenant($request), $id));
    }

    /** GET /app/reports/export: streamed CSV of the filtered message log (≤ 250,000 rows). */
    public function export(Request $request): StreamedResponse
    {
        $ctx = $this->tenant($request);
        $ctx->requirePermission('reports:export');
        $range = DateRange::fromQuery($request->query());
        $f = $this->filters($request);

        return $this->csv('sms-report', fn (callable $write) => $this->reports->exportMessages($ctx, $range, $f, $write));
    }
}
