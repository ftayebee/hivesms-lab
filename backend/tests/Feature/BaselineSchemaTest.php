<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

class BaselineSchemaTest extends TestCase
{
    private const MIGRATION = 'database/migrations/0001_01_01_000000_smsflow_baseline_schema.php';

    private static bool $migrated = false;

    /** Rebuilding 42 tables is slow; build once per class. Tests below restore what they change. */
    protected function setUp(): void
    {
        parent::setUp();
        if (! self::$migrated) {
            Artisan::call('migrate:fresh', ['--force' => true]);
            self::$migrated = true;
        }
    }

    private function baseline(): object
    {
        return require base_path(self::MIGRATION);
    }

    private function sql(): string
    {
        return file_get_contents(database_path('sql/baseline_20260930_init_mysql.sql'));
    }

    public function test_new_database_gets_all_42_application_tables_and_laravel_tables(): void
    {
        $tables = $this->baseline()::tablesIn($this->sql());
        $this->assertCount(42, $tables);
        foreach ([...$tables, 'migrations', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs'] as $table) {
            $this->assertTrue(Schema::hasTable($table), "missing table {$table}");
        }
    }

    public function test_mysql_specific_parts_of_the_baseline_are_applied(): void
    {
        $this->assertSame(1000, (int) DB::table('counters')->where('name', 'invoice_number')->value('value'));

        $checks = collect(DB::select('SELECT CONSTRAINT_NAME AS name FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()'))->pluck('name');
        $this->assertContains('wallets_balance_non_negative', $checks);
        $this->assertContains('wallet_transactions_amount_positive', $checks);

        $collation = DB::selectOne("SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'providerMessageId'")->c;
        $this->assertSame('utf8mb4_bin', $collation);
    }

    public function test_existing_database_is_adopted_without_changes(): void
    {
        DB::table('counters')->where('name', 'invoice_number')->update(['value' => 4242]);
        try {
            $this->baseline()->up();
            $this->assertSame(4242, (int) DB::table('counters')->where('name', 'invoice_number')->value('value'));
        } finally {
            DB::table('counters')->where('name', 'invoice_number')->update(['value' => 1000]);
        }
    }

    public function test_partial_schema_is_refused(): void
    {
        Schema::rename('rate_limit_buckets', 'rate_limit_buckets_hidden');
        try {
            $this->baseline()->up();
            $this->fail('A partial schema must be refused.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('rate_limit_buckets', $e->getMessage());
            $this->assertFalse(Schema::hasTable('rate_limit_buckets'), 'nothing may be created on a partial schema');
        } finally {
            Schema::rename('rate_limit_buckets_hidden', 'rate_limit_buckets');
        }
    }

    public function test_baseline_cannot_be_rolled_back(): void
    {
        $this->expectException(\LogicException::class);
        $this->baseline()->down();
    }

    public function test_statement_splitting_ignores_semicolons_in_comments(): void
    {
        $statements = $this->baseline()::statementsIn("-- a; b\nCREATE TABLE `x` (id INT);\n-- c;\nINSERT INTO `x` VALUES (1);\n");
        $this->assertSame(['CREATE TABLE `x` (id INT)', 'INSERT INTO `x` VALUES (1)'], $statements);
    }
}
