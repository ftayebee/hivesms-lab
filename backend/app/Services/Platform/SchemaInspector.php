<?php

namespace App\Services\Platform;

use Illuminate\Support\Facades\DB;

/**
 * Read-only fingerprint of the application schema (tables, columns, indexes, foreign keys) from
 * information_schema, compared against database/schema/expected-schema.json — the schema the
 * baseline migration (= Prisma `20260930000000_init_mysql`) creates. Used before and after a
 * deployment to prove that nothing changed the 42 application tables. Never writes.
 */
class SchemaInspector
{
    public const EXPECTED_FILE = 'schema/expected-schema.json';

    /** Tables Laravel itself owns (created by its own migrations; not part of the app schema). */
    public const LARAVEL_TABLES = ['migrations', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs', '_prisma_migrations'];

    /** @return array{tables: array<string, array{columns: array<string,string>, indexes: array<string,string>, fks: array<string,string>}>} */
    public function snapshot(): array
    {
        $schema = DB::connection()->getDatabaseName();
        $tables = [];
        foreach (DB::select('SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ? ORDER BY 1', [$schema, 'BASE TABLE']) as $r) {
            if (! in_array($r->t, self::LARAVEL_TABLES, true)) {
                $tables[$r->t] = ['columns' => [], 'indexes' => [], 'fks' => []];
            }
        }
        foreach (DB::select('SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [$schema]) as $r) {
            if (isset($tables[$r->t])) {
                $tables[$r->t]['columns'][$r->c] = self::normalizeType($r->ty).($r->n === 'YES' ? ' NULL' : ' NOT NULL');
            }
        }
        foreach (DB::select('SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE u, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE', [$schema]) as $r) {
            if (isset($tables[$r->t])) {
                $tables[$r->t]['indexes'][$r->i] = ((int) $r->u ? 'INDEX' : 'UNIQUE')."({$r->cols})";
            }
        }
        foreach (DB::select('SELECT k.TABLE_NAME t, k.CONSTRAINT_NAME n, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) c, k.REFERENCED_TABLE_NAME rt, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) rc, r.UPDATE_RULE ur, r.DELETE_RULE dr
            FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.REFERENCED_TABLE_NAME, r.UPDATE_RULE, r.DELETE_RULE', [$schema]) as $r) {
            if (isset($tables[$r->t])) {
                $tables[$r->t]['fks'][$r->n] = "{$r->c} -> {$r->rt}({$r->rc}) ON DELETE ".self::normalizeRule($r->dr).' ON UPDATE '.self::normalizeRule($r->ur);
            }
        }
        foreach ($tables as &$t) {
            ksort($t['indexes']);
            ksort($t['fks']);
        }

        return ['tables' => $tables];
    }

    /** MySQL 8 and MariaDB render the same Prisma types slightly differently. */
    public static function normalizeType(string $type): string
    {
        $type = strtolower($type);
        $type = preg_replace('/^(tinyint|smallint|int|bigint)\(\d+\)/', '$1', $type); // display widths (MariaDB, MySQL 5.7)

        return $type === 'json' ? 'longtext' : $type; // MariaDB stores JSON as LONGTEXT
    }

    /**
     * InnoDB has no deferred constraints: NO ACTION and RESTRICT behave identically, and MariaDB
     * records the same RESTRICT key as either, depending on FOREIGN_KEY_CHECKS when it was added.
     */
    public static function normalizeRule(string $rule): string
    {
        return $rule === 'NO ACTION' ? 'RESTRICT' : $rule;
    }

    /** @return array{tables: array<string, mixed>} */
    public function expected(): array
    {
        return json_decode((string) file_get_contents(database_path(self::EXPECTED_FILE)), true);
    }

    public static function fingerprint(array $snapshot): string
    {
        return hash('sha256', json_encode($snapshot['tables']));
    }

    /**
     * Differences between two snapshots, one line each ("+" only in $actual, "-" only in $expected,
     * "~" changed). Empty = identical.
     *
     * @return list<string>
     */
    public static function diff(array $expected, array $actual): array
    {
        $out = [];
        $e = $expected['tables'];
        $a = $actual['tables'];
        foreach (array_diff_key($e, $a) as $t => $_) {
            $out[] = "- table {$t}";
        }
        foreach (array_diff_key($a, $e) as $t => $_) {
            $out[] = "+ table {$t}";
        }
        foreach (array_intersect_key($e, $a) as $t => $def) {
            foreach (['columns', 'indexes', 'fks'] as $kind) {
                $x = $def[$kind] ?? [];
                $y = $a[$t][$kind] ?? [];
                foreach (array_diff_key($x, $y) as $k => $v) {
                    $out[] = "- {$t}.{$kind}.{$k}: {$v}";
                }
                foreach (array_diff_key($y, $x) as $k => $v) {
                    $out[] = "+ {$t}.{$kind}.{$k}: {$v}";
                }
                foreach (array_intersect_key($x, $y) as $k => $v) {
                    if ($y[$k] !== $v) {
                        $out[] = "~ {$t}.{$kind}.{$k}: {$v} => {$y[$k]}";
                    }
                }
            }
        }

        return $out;
    }
}
