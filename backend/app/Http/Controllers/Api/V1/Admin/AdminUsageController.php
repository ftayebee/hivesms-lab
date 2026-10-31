<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Services\Admin\UsageService;
use App\Support\DateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Customer usage analytics for platform staff (permission on the routes). */
class AdminUsageController extends ApiController
{
    public function __construct(private readonly UsageService $usage) {}

    private function range(Request $request): DateRange
    {
        $request->validate(['range' => ['nullable', 'in:today,7d,30d,90d,custom'], 'from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d']]);

        return DateRange::fromQuery($request->query(), '30d');
    }

    /** GET /admin/usage: every customer's usage in the range, busiest first, with platform totals. */
    public function index(Request $request): JsonResponse
    {
        $q = $request->validate(['q' => ['nullable', 'string', 'max:100'], 'page' => ['nullable', 'integer', 'min:1']]);
        $range = $this->range($request);
        $page = (int) ($q['page'] ?? 1);
        $r = $this->usage->overview($range, $q['q'] ?? null, $page);

        return $this->ok($r['rows'], 200, ['page' => $page, 'pageSize' => 50, 'total' => $r['total'], 'totalPages' => max(1, (int) ceil($r['total'] / 50)),
            'totals' => $r['totals'], 'activeCustomers' => $r['activeCustomers'], 'series' => $r['series'], 'range' => $range->toArray()]);
    }

    /** GET /admin/customers/{id}/usage: one customer's daily usage and breakdowns. */
    public function show(Request $request, string $id): JsonResponse
    {
        $range = $this->range($request);

        return $this->ok($this->usage->customer($id, $range) + ['range' => $range->toArray()]);
    }
}
