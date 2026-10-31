<?php

namespace App\Services\Admin;

use App\Exceptions\AppException;
use App\Models\Organization;
use App\Support\DateRange;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Customer usage analytics for platform staff: who sends how much, how it fares and what it costs
 * them. Counts only; message bodies and recipients are never read here. Days are Dhaka calendar days.
 */
class UsageService
{
    private const COUNTS = "COUNT(*) AS messages, COALESCE(SUM(m.segments), 0) AS segments,
        COALESCE(SUM(m.status = 'DELIVERED'), 0) AS delivered,
        COALESCE(SUM(m.status IN ('QUEUED', 'SUBMITTED')), 0) AS pending,
        COALESCE(SUM(m.status IN ('FAILED', 'REJECTED', 'EXPIRED')), 0) AS failed,
        COALESCE(SUM(CASE WHEN m.refundedAt IS NULL AND m.status <> 'CANCELLED' THEN m.cost ELSE 0 END), 0) AS charged";

    private static function ts(\DateTimeInterface $d): string
    {
        return $d->format('Y-m-d H:i:s.v');
    }

    /** @return array{messages: int, segments: int, delivered: int, pending: int, failed: int, charged: string} */
    private static function counts(object $r): array
    {
        return [
            'messages' => (int) $r->messages,
            'segments' => (int) $r->segments,
            'delivered' => (int) $r->delivered,
            'pending' => (int) $r->pending,
            'failed' => (int) $r->failed,
            'charged' => number_format((float) $r->charged, 4, '.', ''),
        ];
    }

    /** @return list<array{day: string, delivered: int, pending: int, failed: int, spend: float}> every day of the range, including empty ones */
    private function series(DateRange $range, ?string $organizationId): array
    {
        $day = 'DATE_FORMAT(DATE_ADD(m.createdAt, INTERVAL '.Dhaka::OFFSET_MINUTES.' MINUTE), \'%Y-%m-%d\')';
        $where = 'm.createdAt >= ? AND m.createdAt < ?'.($organizationId ? ' AND m.organizationId = ?' : '');
        $bind = [self::ts($range->from), self::ts($range->to), ...($organizationId ? [$organizationId] : [])];
        $rows = collect(DB::select('SELECT '.$day.' AS d, '.self::COUNTS." FROM messages m WHERE {$where} GROUP BY d", $bind))->keyBy('d');

        $out = [];
        for ($i = 0; $i < $range->days; $i++) {
            $d = $range->from->addMinutes(Dhaka::OFFSET_MINUTES)->addDays($i)->format('Y-m-d');
            $r = $rows->get($d);
            $out[] = ['day' => $d, 'delivered' => (int) ($r->delivered ?? 0), 'pending' => (int) ($r->pending ?? 0), 'failed' => (int) ($r->failed ?? 0), 'spend' => (float) ($r->charged ?? 0)];
        }

        return $out;
    }

    /**
     * Every customer, busiest first, so inactive ones are visible too.
     *
     * @return array{rows: list<array>, total: int, totals: array, activeCustomers: int, series: list<array>}
     */
    public function overview(DateRange $range, ?string $search, int $page, int $perPage = 50): array
    {
        $bind = [self::ts($range->from), self::ts($range->to)];
        $totals = DB::selectOne('SELECT '.self::COUNTS.', COUNT(DISTINCT m.organizationId) AS active FROM messages m WHERE m.createdAt >= ? AND m.createdAt < ?', $bind);

        $filter = 'o.deletedAt IS NULL';
        $filterBind = [];
        if ($search !== null && $search !== '') {
            $filter .= ' AND o.name LIKE ?';
            $filterBind[] = '%'.addcslashes($search, '%_\\').'%';
        }
        $total = (int) DB::scalar("SELECT COUNT(*) FROM organizations o WHERE {$filter}", $filterBind);
        $rows = DB::select(
            'SELECT o.id, o.name, o.status, p.name AS plan, '.str_replace('COUNT(*)', 'COUNT(m.id)', self::COUNTS).', MAX(m.createdAt) AS lastSentAt
             FROM organizations o
             LEFT JOIN pricing_plans p ON p.id = o.pricingPlanId
             LEFT JOIN messages m ON m.organizationId = o.id AND m.createdAt >= ? AND m.createdAt < ?
             WHERE '.$filter.'
             GROUP BY o.id, o.name, o.status, p.name
             ORDER BY messages DESC, o.name ASC
             LIMIT ? OFFSET ?',
            [...$bind, ...$filterBind, $perPage, ($page - 1) * $perPage],
        );

        return [
            'rows' => array_map(fn ($r) => [
                'id' => $r->id, 'name' => $r->name, 'status' => $r->status, 'plan' => $r->plan,
                'lastSentAt' => $r->lastSentAt ? Dhaka::iso(CarbonImmutable::parse($r->lastSentAt)) : null,
            ] + self::counts($r), $rows),
            'total' => $total,
            'totals' => self::counts($totals),
            'activeCustomers' => (int) $totals->active,
            'series' => $this->series($range, null),
        ];
    }

    /** @return array{totals: array, series: list<array>, bySource: array<string, int>, byType: array<string, int>} */
    public function customer(string $organizationId, DateRange $range): array
    {
        if (! Organization::query()->whereKey($organizationId)->exists()) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Customer not found.');
        }
        $bind = [$organizationId, self::ts($range->from), self::ts($range->to)];
        $where = 'm.organizationId = ? AND m.createdAt >= ? AND m.createdAt < ?';
        $group = fn (string $column) => collect(DB::select("SELECT m.{$column} AS k, COUNT(*) AS n FROM messages m WHERE {$where} GROUP BY m.{$column}", $bind))
            ->mapWithKeys(fn ($r) => [$r->k => (int) $r->n])->all();

        return [
            'totals' => self::counts(DB::selectOne('SELECT '.self::COUNTS." FROM messages m WHERE {$where}", $bind)),
            'series' => $this->series($range, $organizationId),
            'bySource' => $group('source'),
            'byType' => $group('smsType'),
        ];
    }
}
