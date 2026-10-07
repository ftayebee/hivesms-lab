<?php

namespace App\Support;

/**
 * Decimal money arithmetic on strings (bcmath), never floats. Storage precision is 4 decimal
 * places (DECIMAL(14,4)); display/charges round half-up to 2 (port of src/lib/money.ts).
 */
final class Money
{
    private const SCALE = 10;

    public static function normalize(string|int|float|null $value): string
    {
        if ($value === null || $value === '') {
            return '0';
        }
        if (is_float($value)) {
            // Floats only ever come from validated user input (e.g. a top-up amount); format exactly.
            $value = number_format($value, 6, '.', '');
        }
        $value = trim((string) $value);
        if (! preg_match('/^-?\d+(\.\d+)?$/', $value)) {
            throw new \InvalidArgumentException("Not a decimal number: {$value}");
        }

        return $value;
    }

    public static function add(string|int|float $a, string|int|float $b): string
    {
        return bcadd(self::normalize($a), self::normalize($b), self::SCALE);
    }

    public static function sub(string|int|float $a, string|int|float $b): string
    {
        return bcsub(self::normalize($a), self::normalize($b), self::SCALE);
    }

    public static function mul(string|int|float $a, string|int|float $b): string
    {
        return bcmul(self::normalize($a), self::normalize($b), self::SCALE);
    }

    public static function div(string|int|float $a, string|int|float $b): string
    {
        return bcdiv(self::normalize($a), self::normalize($b), self::SCALE);
    }

    public static function cmp(string|int|float $a, string|int|float $b): int
    {
        return bccomp(self::normalize($a), self::normalize($b), self::SCALE);
    }

    public static function isPositive(string|int|float $a): bool
    {
        return self::cmp($a, '0') > 0;
    }

    /** Half-up rounding (away from zero for negatives) to $dp decimal places, returned with exactly $dp decimals. */
    public static function round(string|int|float $value, int $dp = 2): string
    {
        $v = self::normalize($value);
        $offset = '0.'.str_repeat('0', $dp).'5';
        if ($dp === 0) {
            $offset = '0.5';
        }
        $rounded = str_starts_with($v, '-') ? bcsub($v, $offset, $dp) : bcadd($v, $offset, $dp);
        // bcadd truncates to $dp, which together with the +0.5 ulp offset is half-up rounding.
        if (preg_match('/^-0(\.0+)?$/', $rounded)) {
            $rounded = ltrim($rounded, '-');
        }

        return $rounded;
    }

    /** Fixed decimals for JSON (string keeps precision). */
    public static function format(string|int|float|null $value, int $dp = 2): string
    {
        return self::round($value ?? '0', $dp);
    }

    /** Shortest exact representation ("0.3500" → "0.35", "5.0000" → "5"), like decimal.js toString(). */
    public static function plain(string|int|float|null $value): string
    {
        $v = self::normalize($value);
        if (str_contains($v, '.')) {
            $v = rtrim(rtrim($v, '0'), '.');
        }

        return $v === '-0' || $v === '' ? '0' : $v;
    }

    /** Integer part (floor for non-negative values). */
    public static function floorInt(string $value): int
    {
        return (int) bcadd(self::normalize($value), '0', 0);
    }

    /** "BDT 1,234.50" (as formatBDT in src/lib/format.ts, English locale). */
    public static function formatBdt(string|int|float|null $value): string
    {
        $rounded = self::round($value ?? '0', 2);
        [$int, $frac] = explode('.', ltrim($rounded, '-'));

        return 'BDT '.(str_starts_with($rounded, '-') ? '-' : '').number_format((int) $int).'.'.$frac;
    }
}
