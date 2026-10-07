<?php

namespace App\Support;

/**
 * Bangladesh mobile numbers (port of src/lib/phone.ts). Valid: 01[3-9]XXXXXXXX nationally,
 * +8801[3-9]XXXXXXXX in E.164. Accepted input forms: 01712345678, 8801712345678, +8801712345678,
 * "+880 1712-345678", 008801712345678, 1712345678. The platform is Bangladesh-only: anything
 * else is invalid (it is never silently rewritten).
 *
 * Operator detection is prefix-based; with mobile number portability it is a reporting hint only.
 */
final class Phone
{
    private const BD_MOBILE_E164 = '/^\+8801[3-9]\d{8}$/';

    private const PREFIX_OPERATOR = [
        '013' => 'Grameenphone',
        '017' => 'Grameenphone',
        '014' => 'Banglalink',
        '019' => 'Banglalink',
        '015' => 'Teletalk',
        '016' => 'Airtel',
        '018' => 'Robi',
    ];

    public static function normalize(?string $input): ?string
    {
        if ($input === null) {
            return null;
        }
        $digits = preg_replace('/[\s\-().]/u', '', trim($input)) ?? '';
        if ($digits === '') {
            return null;
        }
        if (str_starts_with($digits, '+')) {
            $digits = substr($digits, 1);
        }
        if (! preg_match('/^\d+$/', $digits)) {
            return null;
        }
        if (str_starts_with($digits, '00880')) {
            $digits = substr($digits, 2);
        }

        if (str_starts_with($digits, '880')) {
            $national = '0'.substr($digits, 3);
        } elseif (str_starts_with($digits, '01')) {
            $national = $digits;
        } elseif (str_starts_with($digits, '1') && strlen($digits) === 10) {
            $national = '0'.$digits;
        } else {
            return null;
        }

        if (strlen($national) !== 11) {
            return null;
        }
        $e164 = '+88'.$national;

        return preg_match(self::BD_MOBILE_E164, $e164) ? $e164 : null;
    }

    public static function isValid(?string $input): bool
    {
        return self::normalize($input) !== null;
    }

    public static function operator(string $e164): string
    {
        $national = str_starts_with($e164, '+880') ? '0'.substr($e164, 4) : $e164;

        return self::PREFIX_OPERATOR[substr($national, 0, 3)] ?? 'Unknown';
    }

    /** For logs: +8801712345678 -> +880171****678 */
    public static function mask(string $phone): string
    {
        return strlen($phone) < 8 ? '****' : substr($phone, 0, 7).'****'.substr($phone, -3);
    }

    /**
     * Free-form list (comma, semicolon, whitespace or newline separated) → normalised, de-duplicated.
     *
     * @return array{valid: list<string>, invalid: list<string>, duplicates: int}
     */
    public static function parseList(string $raw, int $limit = 100000): array
    {
        $tokens = array_slice(array_values(array_filter(array_map('trim', preg_split('/[\s,;]+/u', $raw) ?: []), fn ($t) => $t !== '')), 0, $limit);
        $seen = [];
        $valid = [];
        $invalid = [];
        $duplicates = 0;
        foreach ($tokens as $token) {
            $n = self::normalize($token);
            if ($n === null) {
                $invalid[] = $token;

                continue;
            }
            if (isset($seen[$n])) {
                $duplicates++;

                continue;
            }
            $seen[$n] = true;
            $valid[] = $n;
        }

        return ['valid' => $valid, 'invalid' => $invalid, 'duplicates' => $duplicates];
    }

    /** Splits pasted numbers without validating them (campaign audiences keep invalid ones to report). */
    public static function splitTokens(string $raw, int $limit = 100000): array
    {
        return array_slice(array_values(array_filter(array_map('trim', preg_split('/[\s,;]+/u', $raw) ?: []), fn ($t) => $t !== '')), 0, $limit);
    }
}
