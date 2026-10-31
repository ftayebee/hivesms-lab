<?php

namespace App\Support;

use DateTimeInterface;

/**
 * CSV import/export with CSV-injection protection (port of src/lib/csv.ts). Exported cells
 * starting with = + - @ tab or CR get a leading quote so spreadsheets show them as text.
 */
final class Csv
{
    private const DANGEROUS_PREFIX = '/^[=+\-@\t\r]/';

    public static function sanitizeCell(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if ($value instanceof DateTimeInterface) {
            $str = Dhaka::iso($value);
        } elseif (is_bool($value)) {
            $str = $value ? 'true' : 'false';
        } else {
            $str = (string) $value;
        }

        return preg_match(self::DANGEROUS_PREFIX, $str) ? "'".$str : $str;
    }

    /** One CSV line, every field quoted, CRLF terminated. */
    public static function line(array $cells): string
    {
        return implode(',', array_map(fn ($c) => '"'.str_replace('"', '""', self::sanitizeCell($c)).'"', $cells))."\r\n";
    }

    /** UTF-8 BOM so Excel opens Bangla text correctly. */
    public static function bom(): string
    {
        return "\u{FEFF}";
    }

    /** Removes the protective quote added on export so a round trip is lossless. */
    public static function unescapeCell(string $value): string
    {
        return str_starts_with($value, "'") && preg_match(self::DANGEROUS_PREFIX, substr($value, 1)) ? substr($value, 1) : $value;
    }

    /**
     * Streams a CSV file with a header row: headers are trimmed, lower-cased and spaces → "_".
     * Calls $onRow(array $assoc, int $line) for each non-empty row (line numbers are 1-based,
     * the header is line 1). Stops after $maxRows data rows and returns how many were read.
     */
    public static function each(string $path, callable $onRow, int $maxRows, ?array &$headers = null): int
    {
        $fh = fopen($path, 'rb');
        if ($fh === false) {
            throw new \RuntimeException('Cannot open CSV file');
        }
        try {
            $first = fgetcsv($fh, null, ',', '"', '');
            if ($first === false || $first === [null]) {
                $headers = [];

                return 0;
            }
            if (isset($first[0])) {
                $first[0] = preg_replace('/^\x{FEFF}/u', '', (string) $first[0]);
            }
            $headers = array_map(fn ($h) => preg_replace('/\s+/', '_', strtolower(trim((string) $h))), $first);
            $count = 0;
            $line = 1;
            while (($row = fgetcsv($fh, null, ',', '"', '')) !== false) {
                $line++;
                if ($row === [null] || count(array_filter($row, fn ($v) => trim((string) $v) !== '')) === 0) {
                    continue; // greedy empty-line skipping
                }
                if ($count >= $maxRows) {
                    return $count + 1; // signals "too many rows"
                }
                $assoc = [];
                foreach ($headers as $i => $h) {
                    if ($h === '') {
                        continue;
                    }
                    $assoc[$h] = trim((string) ($row[$i] ?? ''));
                }
                $count++;
                $onRow($assoc, $line);
            }

            return $count;
        } finally {
            fclose($fh);
        }
    }
}
