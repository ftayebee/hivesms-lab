<?php

namespace App\Services\Report;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\Campaign;
use App\Models\Message;
use App\Models\WalletTransaction;
use App\Services\Platform\AuditLogger;
use App\Support\Csv;
use App\Support\DateRange;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Reporting (port of features/reports/{queries,messages}.ts). All aggregation runs in the database
 * (COUNT/SUM/GROUP BY on the (organizationId, createdAt) and (organizationId, status) indexes);
 * nothing loads message rows into memory except paginated pages and streamed exports. Days are
 * bucketed in Asia/Dhaka.
 */
class ReportService
{
    public const PAGE_SIZE = 25;

    private const FAILED = ['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Normalises report filters from query input.
     *
     * @return array{campaignId?: string, senderValue?: string, status?: string, to?: string, source?: string}
     */
    public static function filters(array $q): array
    {
        $f = [];
        if (! empty($q['campaign']) && is_string($q['campaign']) && preg_match('/^[0-9a-f-]{36}$/i', $q['campaign'])) {
            $f['campaignId'] = $q['campaign'];
        }
        if (! empty($q['sender']) && is_string($q['sender'])) {
            $f['senderValue'] = mb_substr(trim($q['sender']), 0, 20);
        }
        if (! empty($q['status']) && in_array(strtoupper((string) $q['status']), ['QUEUED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'], true)) {
            $f['status'] = strtoupper((string) $q['status']);
        }
        $recipient = $q['recipient'] ?? $q['phone'] ?? null;
        if (is_string($recipient) && trim($recipient) !== '') {
            $f['to'] = Phone::normalize($recipient) ?? mb_substr(trim($recipient), 0, 30);
        }
        if (! empty($q['source']) && in_array(strtoupper((string) $q['source']), ['API', 'CAMPAIGN', 'DASHBOARD'], true)) {
            $f['source'] = strtoupper((string) $q['source']);
        }

        return $f;
    }

    /** @return array{0: string, 1: list<mixed>} SQL WHERE + bindings */
    private function where(TenantContext $ctx, DateRange $range, array $f): array
    {
        $sql = ['organizationId = ?', 'createdAt >= ?', 'createdAt < ?'];
        $b = [$ctx->organizationId, $range->from->format('Y-m-d H:i:s.v'), $range->to->format('Y-m-d H:i:s.v')];
        foreach (['campaignId' => 'campaignId', 'senderValue' => 'senderValue', 'status' => 'status', 'to' => '`to`', 'source' => 'source'] as $k => $col) {
            if (isset($f[$k])) {
                $sql[] = "{$col} = ?";
                $b[] = $f[$k];
            }
        }

        return [implode(' AND ', $sql), $b];
    }

    /** @return array{total: int, queued: int, sent: int, delivered: int, failed: int, pending: int, segments: int, deliveryRate: ?float} */
    public function statusTotals(TenantContext $ctx, DateRange $range, array $f = []): array
    {
        [$w, $b] = $this->where($ctx, $range, $f);
        $rows = DB::select("SELECT status, COUNT(*) AS n, COALESCE(SUM(segments), 0) AS segs FROM messages WHERE {$w} GROUP BY status", $b);
        $by = fn (array $s) => array_sum(array_map(fn ($r) => in_array($r->status, $s, true) ? (int) $r->n : 0, $rows));
        $delivered = $by(['DELIVERED']);
        $failed = $by(self::FAILED);
        $queued = $by(['QUEUED']);
        $sent = $by(['SUBMITTED']);

        return [
            'total' => array_sum(array_map(fn ($r) => (int) $r->n, $rows)),
            'queued' => $queued,
            'sent' => $sent,
            'delivered' => $delivered,
            'failed' => $failed,
            'pending' => $queued + $sent,
            'segments' => array_sum(array_map(fn ($r) => (int) $r->segs, $rows)),
            'deliveryRate' => $delivered + $failed > 0 ? round($delivered / ($delivered + $failed), 4) : null,
        ];
    }

    /** @return list<array{day: string, delivered: int, failed: int, pending: int, spend: string}> zero-filled */
    public function dailySeries(TenantContext $ctx, DateRange $range, array $f = []): array
    {
        [$w, $b] = $this->where($ctx, $range, $f);
        $day = Dhaka::daySql('createdAt');
        $rows = collect(DB::select("SELECT {$day} AS day,
                COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered,
                COUNT(CASE WHEN status IN ('FAILED','REJECTED','EXPIRED','CANCELLED') THEN 1 END) AS failed,
                COUNT(CASE WHEN status IN ('QUEUED','SUBMITTED') THEN 1 END) AS pending,
                CAST(COALESCE(SUM(CASE WHEN refundedAt IS NULL THEN cost END), 0) AS CHAR) AS spend
            FROM messages WHERE {$w} GROUP BY 1 ORDER BY 1", $b))->keyBy('day');

        return array_map(fn ($d) => [
            'day' => $d,
            'delivered' => (int) ($rows[$d]->delivered ?? 0),
            'failed' => (int) ($rows[$d]->failed ?? 0),
            'pending' => (int) ($rows[$d]->pending ?? 0),
            'spend' => Money::round($rows[$d]->spend ?? '0', 2),
        ], $range->dayKeys());
    }

    /** Net SMS spend in the range from the ledger: charges minus refunds. */
    public function spend(TenantContext $ctx, DateRange $range): array
    {
        $sums = WalletTransaction::query()->where('organizationId', $ctx->organizationId)
            ->where('createdAt', '>=', $range->from->format('Y-m-d H:i:s.v'))->where('createdAt', '<', $range->to->format('Y-m-d H:i:s.v'))
            ->whereIn('reason', ['SMS_CHARGE', 'REFUND'])->groupBy('reason')
            ->selectRaw('reason, CAST(COALESCE(SUM(amount), 0) AS CHAR) AS total')->pluck('total', 'reason');
        $charged = (string) ($sums['SMS_CHARGE'] ?? '0');
        $refunded = (string) ($sums['REFUND'] ?? '0');

        return ['charged' => Money::round($charged, 2), 'refunded' => Money::round($refunded, 2), 'net' => Money::round(Money::sub($charged, $refunded), 2)];
    }

    public function operators(TenantContext $ctx, DateRange $range, array $f = []): array
    {
        [$w, $b] = $this->where($ctx, $range, $f);

        return array_map(fn ($r) => ['operator' => $r->operator ?? 'Unknown', 'total' => (int) $r->total, 'delivered' => (int) $r->delivered], DB::select(
            "SELECT operator, COUNT(*) AS total, COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered FROM messages WHERE {$w} GROUP BY operator ORDER BY total DESC",
            $b,
        ));
    }

    public function failureReasons(TenantContext $ctx, DateRange $range, array $f = [], int $limit = 6): array
    {
        [$w, $b] = $this->where($ctx, $range, $f);

        return array_map(fn ($r) => ['reason' => $r->reason ?? 'Unknown', 'count' => (int) $r->n], DB::select(
            "SELECT COALESCE(errorMessage, 'Unknown') AS reason, COUNT(*) AS n FROM messages WHERE {$w} AND status IN ('FAILED','REJECTED','EXPIRED','CANCELLED') GROUP BY 1 ORDER BY n DESC LIMIT ".max(1, min(50, $limit)),
            $b,
        ));
    }

    public function campaignPerformance(TenantContext $ctx, DateRange $range, int $take = 6): array
    {
        return Campaign::query()->where('organizationId', $ctx->organizationId)
            ->where('startedAt', '>=', $range->from->format('Y-m-d H:i:s.v'))->where('startedAt', '<', $range->to->format('Y-m-d H:i:s.v'))
            ->whereIn('status', ['COMPLETED', 'PROCESSING'])->orderByDesc('startedAt')->limit($take)
            ->get(['id', 'name', 'deliveredCount', 'failedCount', 'submittedCount', 'recipientCount'])->toArray();
    }

    /** Campaign summary report: per campaign counters in the range (paginated). */
    public function campaigns(TenantContext $ctx, DateRange $range, int $page): LengthAwarePaginator
    {
        $ctx->requirePermission('reports:read');

        return Campaign::query()->where('organizationId', $ctx->organizationId)
            ->where('createdAt', '>=', $range->from->format('Y-m-d H:i:s.v'))->where('createdAt', '<', $range->to->format('Y-m-d H:i:s.v'))
            ->orderByDesc('createdAt')
            ->paginate(self::PAGE_SIZE, ['id', 'name', 'status', 'smsType', 'senderValue', 'recipientCount', 'skippedCount', 'submittedCount', 'deliveredCount', 'failedCount', 'actualCost', 'refundedAmount', 'startedAt', 'completedAt', 'createdAt'], 'page', $page);
    }

    // ─── Message history ───

    private function messageQuery(TenantContext $ctx, DateRange $range, array $f): Builder
    {
        $q = Message::query()->where('organizationId', $ctx->organizationId)
            ->where('createdAt', '>=', $range->from->format('Y-m-d H:i:s.v'))->where('createdAt', '<', $range->to->format('Y-m-d H:i:s.v'));
        foreach (['campaignId', 'senderValue', 'status', 'to', 'source'] as $k) {
            if (isset($f[$k])) {
                $q->where($k, $f[$k]);
            }
        }

        return $q;
    }

    public function messages(TenantContext $ctx, DateRange $range, array $f, int $page): LengthAwarePaginator
    {
        $ctx->requirePermission('reports:read');

        return $this->messageQuery($ctx, $range, $f)
            ->with('campaign:id,name')
            ->orderByDesc('createdAt')
            ->paginate(self::PAGE_SIZE, ['id', 'to', 'status', 'senderValue', 'smsType', 'source', 'segments', 'cost', 'createdAt', 'errorMessage', 'campaignId'], 'page', $page);
    }

    public function message(TenantContext $ctx, string $id): Message
    {
        $ctx->requirePermission('reports:read');

        return Message::query()
            ->with(['events' => fn ($q) => $q->orderBy('occurredAt'), 'campaign:id,name', 'apiKey:id,name,prefix'])
            ->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Message not found.');
    }

    public function exportMessages(TenantContext $ctx, DateRange $range, array $f, callable $write): void
    {
        $ctx->requirePermission('reports:export');
        $write(Csv::bom().Csv::line(['created_at', 'phone', 'status', 'type', 'source', 'sender_id', 'campaign', 'segments', 'encoding', 'cost_bdt', 'refunded', 'operator', 'error', 'submitted_at', 'delivered_at', 'failed_at', 'reference', 'message_id']));
        $count = 0;
        $this->messageQuery($ctx, $range, $f)->with('campaign:id,name')->chunkById(5000, function ($rows) use ($write, &$count) {
            $out = '';
            foreach ($rows as $m) {
                $out .= Csv::line([
                    $m->createdAt, $m->to, $m->status->value, $m->smsType->value, $m->source->value, $m->senderValue, $m->campaign?->name, $m->segments,
                    $m->encoding->value, Money::round((string) $m->cost, 2), $m->refundedAt ? 'yes' : 'no', $m->operator, $m->errorMessage,
                    $m->submittedAt, $m->deliveredAt, $m->failedAt, $m->clientReference, $m->id,
                ]);
                $count++;
            }
            $write($out);

            return $count < 250000;
        });
        $this->audit->log('report.export', $ctx->actor(), $ctx->organizationId, metadata: ['rows' => $count, 'from' => Dhaka::iso($range->from), 'to' => Dhaka::iso($range->to)]);
    }
}
