<?php

namespace App\Services\Sms;

/**
 * SMS character counting and segmentation (exact port of src/lib/sms-segments.ts, which the
 * Next.js composer also uses for its live preview — results must match).
 *
 * - GSM-7: basic set = 1 unit; extension table chars ({ } [ ] ~ \ | ^ € form feed) = 2 units
 *   (escape + char) and are never split across parts.
 * - UCS-2: any char outside GSM-7 (Bangla, emoji, …) switches the whole message to UCS-2.
 *   Counting is in UTF-16 code units; a surrogate pair (emoji) = 2 units, never split.
 * Limits come from the (admin-configurable) segmentation rules: default 160/153 and 70/67.
 */
final class MessageSegmentCalculator
{
    public const STANDARD_RULES = [
        'gsm7' => ['single' => 160, 'multipart' => 153],
        'ucs2' => ['single' => 70, 'multipart' => 67],
        'maxSegments' => 10,
    ];

    // GSM 03.38 basic character set (including LF and CR).
    private const GSM7_BASIC = "@£\$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

    private const GSM7_EXTENDED = "^{}\\[~]|€\f";

    /** @var array<string, true>|null */
    private static ?array $basic = null;

    /** @var array<string, true>|null */
    private static ?array $extended = null;

    private static function sets(): void
    {
        if (self::$basic === null) {
            self::$basic = array_fill_keys(mb_str_split(self::GSM7_BASIC), true);
            self::$extended = array_fill_keys(mb_str_split(self::GSM7_EXTENDED), true);
        }
    }

    /** @return array{encoding: 'GSM7'|'UCS2', nonGsm: list<string>} */
    public static function detectEncoding(string $text): array
    {
        self::sets();
        $nonGsm = [];
        foreach (mb_str_split($text) as $ch) {
            if (! isset(self::$basic[$ch]) && ! isset(self::$extended[$ch])) {
                if (count($nonGsm) < 5 && ! in_array($ch, $nonGsm, true)) {
                    $nonGsm[] = $ch;
                }
                if (count($nonGsm) >= 5) {
                    break;
                }
            }
        }

        return ['encoding' => $nonGsm ? 'UCS2' : 'GSM7', 'nonGsm' => $nonGsm];
    }

    private static function charUnits(string $ch, string $encoding): int
    {
        if ($encoding === 'GSM7') {
            return isset(self::$extended[$ch]) ? 2 : 1;
        }

        // UTF-16 code units: 2 for characters outside the Basic Multilingual Plane (emoji).
        return mb_ord($ch, 'UTF-8') > 0xFFFF ? 2 : 1;
    }

    /** @param list<string> $chars */
    private static function splitParts(array $chars, string $encoding, int $perPart): int
    {
        $parts = 1;
        $used = 0;
        foreach ($chars as $ch) {
            $u = self::charUnits($ch, $encoding);
            if ($used + $u > $perPart) {
                $parts++;
                $used = $u;
            } else {
                $used += $u;
            }
        }

        return $parts;
    }

    /**
     * @param  array{gsm7: array{single:int, multipart:int}, ucs2: array{single:int, multipart:int}, maxSegments:int}|null  $rules
     * @return array{encoding: 'GSM7'|'UCS2', characters: int, units: int, segments: int, perSegment: int, remainingInSegment: int, nonGsmCharacters: list<string>, exceedsMax: bool}
     */
    public static function calculate(string $text, ?array $rules = null): array
    {
        self::sets();
        $rules ??= self::STANDARD_RULES;
        ['encoding' => $encoding, 'nonGsm' => $nonGsm] = self::detectEncoding($text);
        $chars = $text === '' ? [] : mb_str_split($text);
        $limits = $encoding === 'GSM7' ? $rules['gsm7'] : $rules['ucs2'];
        $units = 0;
        foreach ($chars as $ch) {
            $units += self::charUnits($ch, $encoding);
        }

        if ($units === 0) {
            $segments = 0;
            $perSegment = (int) $limits['single'];
        } elseif ($units <= $limits['single']) {
            $segments = 1;
            $perSegment = (int) $limits['single'];
        } else {
            $segments = self::splitParts($chars, $encoding, (int) $limits['multipart']);
            $perSegment = (int) $limits['multipart'];
        }

        $capacity = $segments <= 1 ? (int) $limits['single'] : $segments * (int) $limits['multipart'];

        return [
            'encoding' => $encoding,
            'characters' => count($chars),
            'units' => $units,
            'segments' => $segments,
            'perSegment' => $perSegment,
            'remainingInSegment' => max(0, $capacity - $units),
            'nonGsmCharacters' => $nonGsm,
            'exceedsMax' => $segments > (int) $rules['maxSegments'],
        ];
    }

    /** Renders {{variable}} placeholders; unknown variables become empty strings. */
    public static function renderTemplate(string $body, array $vars): string
    {
        return preg_replace_callback('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', fn ($m) => (string) ($vars[$m[1]] ?? ''), $body) ?? $body;
    }

    /** @return list<string> */
    public static function extractVariables(string $body): array
    {
        preg_match_all('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', $body, $m);

        return array_values(array_unique($m[1]));
    }
}
