<?php

namespace App\Services\Sms;

/**
 * Safe, size-limited summary of a provider answer for messages.providerResponse and
 * message_events.payload: credential-like keys are removed, phone numbers are masked to their
 * last three digits, long strings are cut, and the whole JSON is capped at 2 KB.
 */
final class ProviderResponseRedactor
{
    public const MAX_BYTES = 2048;

    private const SECRET_KEY = '/(api[_-]?key|apikey|token|secret|password|passwd|auth|signature|credential|cookie|session)/i';

    private const PHONE_KEY = '/^(msisdn|to|phone|mobile|number|recipient|destination)$/i';

    public static function summarize(mixed $raw): ?array
    {
        if ($raw === null || $raw === '' || $raw === []) {
            return null;
        }
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : ['body' => $raw];
        }
        if (! is_array($raw)) {
            $raw = ['value' => is_scalar($raw) ? (string) $raw : get_debug_type($raw)];
        }
        $clean = self::walk($raw, 0);
        $json = json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
        if (strlen($json) > self::MAX_BYTES) {
            return ['truncated' => true, 'excerpt' => mb_strcut($json, 0, self::MAX_BYTES - 64)];
        }

        return $clean;
    }

    private static function walk(array $data, int $depth): array
    {
        $out = [];
        $i = 0;
        foreach ($data as $k => $v) {
            if (++$i > 50) {
                $out['_more'] = true;
                break;
            }
            $key = (string) $k;
            if (preg_match(self::SECRET_KEY, $key)) {
                $out[$key] = '[redacted]';

                continue;
            }
            if (is_array($v)) {
                $out[$key] = $depth >= 4 ? '[nested]' : self::walk($v, $depth + 1);
            } elseif (is_string($v) || is_int($v) || is_float($v)) {
                if (preg_match(self::PHONE_KEY, $key)) {
                    $out[$key] = self::maskPhone((string) $v);
                } else {
                    $out[$key] = is_string($v) ? mb_substr(self::maskEmbeddedPhones($v), 0, 300) : $v;
                }
            } else {
                $out[$key] = $v;
            }
        }

        return $out;
    }

    public static function maskPhone(string $s): string
    {
        $digits = preg_replace('/\D/', '', $s) ?? '';

        return strlen($digits) >= 6 ? str_repeat('*', strlen($digits) - 3).substr($digits, -3) : $s;
    }

    private static function maskEmbeddedPhones(string $s): string
    {
        return preg_replace_callback('/(?<!\d)(?:\+?88)?01\d{9}(?!\d)/', fn ($m) => self::maskPhone($m[0]), $s) ?? $s;
    }
}
