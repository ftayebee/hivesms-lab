<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Baseline of the SMSFlow schema (the 42 tables the Next.js/Prisma app created with its
 * `20260930000000_init_mysql` migration). Laravel adopts these tables; it does not redesign them.
 *
 *  - All baseline tables exist (existing/production database) → nothing is changed.
 *  - None exist (new database)                                 → the baseline SQL is applied.
 *  - Some exist                                                → abort; never guess on a partial schema.
 *
 * It cannot be rolled back: rolling back would drop every customer table.
 */
return new class extends Migration
{
    public const SQL_FILE = 'sql/baseline_20260930_init_mysql.sql';

    public function up(): void
    {
        $sql = file_get_contents(database_path(self::SQL_FILE));
        $tables = self::tablesIn($sql);
        $existing = array_values(array_filter($tables, fn (string $t) => Schema::hasTable($t)));

        if (count($existing) === count($tables)) {
            return;
        }
        if ($existing !== []) {
            $missing = array_values(array_diff($tables, $existing));
            throw new RuntimeException(
                'Partial SMSFlow schema found (missing: '.implode(', ', $missing).'). '.
                'Refusing to modify it; inspect the database and repair it manually.'
            );
        }

        // New, empty database: with FK checks off, MySQL/MariaDB add foreign keys in place instead
        // of copying every table once per key. No rows exist, so no constraint can be violated.
        DB::statement('SET FOREIGN_KEY_CHECKS = 0');
        try {
            foreach (self::statementsIn($sql) as $statement) {
                DB::unprepared($statement);
            }
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS = 1');
        }
    }

    public function down(): void
    {
        throw new LogicException('The SMSFlow baseline schema cannot be rolled back.');
    }

    /** @return list<string> */
    public static function tablesIn(string $sql): array
    {
        preg_match_all('/^CREATE TABLE `([^`]+)`/m', $sql, $m);

        return $m[1];
    }

    /**
     * Statements in the dump. Comment lines are removed first (some contain semicolons); no
     * statement contains a semicolon inside a string literal.
     *
     * @return list<string>
     */
    public static function statementsIn(string $sql): array
    {
        $withoutComments = preg_replace('/^\s*--.*$/m', '', str_replace("\r\n", "\n", $sql));
        $parts = preg_split('/;\s*$/m', $withoutComments);

        return array_values(array_filter(array_map('trim', $parts), fn (string $s) => $s !== ''));
    }
};
