<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * Asia/Dhaka calendar helpers (port of the date parts of src/lib/format.ts). Dhaka is UTC+6 with
 * no DST; the database stores UTC. Day bucketing in SQL uses the fixed offset so it needs no
 * time-zone tables (shared MySQL hosting usually does not load them).
 */
final class Dhaka
{
    public const TZ = 'Asia/Dhaka';

    public const OFFSET_MINUTES = 360;

    public static function now(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC');
    }

    /** Start of the Dhaka day containing $at, as a UTC instant. */
    public static function startOfDay(?CarbonImmutable $at = null): CarbonImmutable
    {
        return ($at ?? self::now())->setTimezone(self::TZ)->startOfDay()->setTimezone('UTC');
    }

    public static function startOfMonth(?CarbonImmutable $at = null): CarbonImmutable
    {
        return ($at ?? self::now())->setTimezone(self::TZ)->startOfMonth()->setTimezone('UTC');
    }

    public static function hour(?CarbonImmutable $at = null): int
    {
        return (int) ($at ?? self::now())->setTimezone(self::TZ)->format('G');
    }

    /** YYYY-MM-DD in Dhaka. */
    public static function dateKey(CarbonImmutable $at): string
    {
        return $at->setTimezone(self::TZ)->format('Y-m-d');
    }

    /** "YYYY-MM-DD" interpreted as a Dhaka calendar day → UTC instant of its midnight. */
    public static function parseDate(string $value): ?CarbonImmutable
    {
        if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }

        return CarbonImmutable::create((int) $m[1], (int) $m[2], (int) $m[3], 0, 0, 0, self::TZ)->setTimezone('UTC');
    }

    /** <input type="datetime-local"> value ("YYYY-MM-DDTHH:MM") in Dhaka time → UTC. */
    public static function parseLocalInput(?string $value): ?CarbonImmutable
    {
        if (! $value || ! preg_match('/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/', $value, $m)) {
            return null;
        }
        if (! checkdate((int) $m[2], (int) $m[3], (int) $m[1]) || (int) $m[4] > 23 || (int) $m[5] > 59) {
            return null;
        }

        return CarbonImmutable::create((int) $m[1], (int) $m[2], (int) $m[3], (int) $m[4], (int) $m[5], 0, self::TZ)->setTimezone('UTC');
    }

    /** SQL: Dhaka calendar day of a UTC DATETIME column. $column must be a trusted identifier. */
    public static function daySql(string $column): string
    {
        if (! preg_match('/^[A-Za-z_]+$/', $column)) {
            throw new \InvalidArgumentException('Invalid column');
        }

        return "DATE_FORMAT(DATE_ADD(`{$column}`, INTERVAL ".self::OFFSET_MINUTES." MINUTE), '%Y-%m-%d')";
    }

    /** "Oct 7, 2026, 3:15 PM" in Dhaka (used in auto-generated names and notification text). */
    public static function formatDateTime(CarbonImmutable $at): string
    {
        return $at->setTimezone(self::TZ)->format('M j, Y, g:i A');
    }

    /** ISO-8601 UTC with milliseconds, like JavaScript's Date#toISOString(). */
    public static function iso(?\DateTimeInterface $at): ?string
    {
        return $at ? CarbonImmutable::instance($at)->setTimezone('UTC')->format('Y-m-d\TH:i:s.v\Z') : null;
    }
}
