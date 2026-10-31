<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * Report date ranges in Asia/Dhaka calendar days (port of src/features/reports/range.ts).
 * Query: range=today|7d|30d|90d|custom (&from=YYYY-MM-DD&to=YYYY-MM-DD, at most 366 days).
 */
final class DateRange
{
    public const PRESETS = ['today' => 1, '7d' => 7, '30d' => 30, '90d' => 90];

    public function __construct(
        public readonly string $key,
        public readonly CarbonImmutable $from,
        public readonly CarbonImmutable $to,
        public readonly int $days,
        public readonly string $label,
    ) {}

    /** @param array<string, mixed> $query */
    public static function fromQuery(array $query, string $fallback = '30d'): self
    {
        $key = is_string($query['range'] ?? null) ? $query['range'] : $fallback;
        $todayStart = Dhaka::startOfDay();

        if ($key === 'custom') {
            $from = is_string($query['from'] ?? null) ? Dhaka::parseDate($query['from']) : null;
            $toDay = is_string($query['to'] ?? null) ? Dhaka::parseDate($query['to']) : null;
            if ($from && $toDay && $from <= $toDay && $from->diffInDays($toDay) <= 366) {
                $to = $toDay->addDay();

                return new self('custom', $from, $to, (int) round($from->diffInDays($to)), Dhaka::dateKey($from).' to '.Dhaka::dateKey($toDay));
            }
        }

        if (! isset(self::PRESETS[$key])) {
            $key = isset(self::PRESETS[$fallback]) ? $fallback : '30d';
        }
        $days = self::PRESETS[$key];
        $labels = ['today' => 'Today', '7d' => '7 days', '30d' => '30 days', '90d' => '90 days'];

        return new self($key, $todayStart->subDays($days - 1), $todayStart->addDay(), $days, $labels[$key]);
    }

    /** @return list<string> every Dhaka day key in the range */
    public function dayKeys(): array
    {
        $out = [];
        for ($t = $this->from; $t < $this->to; $t = $t->addDay()) {
            $out[] = Dhaka::dateKey($t);
        }

        return $out;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['key' => $this->key, 'from' => Dhaka::iso($this->from), 'to' => Dhaka::iso($this->to), 'days' => $this->days, 'label' => $this->label];
    }
}
