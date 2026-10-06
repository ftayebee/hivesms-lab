<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSafeTestDatabase();
    }

    /**
     * Tests wipe their database (migrate:fresh). Refuse to run against anything other than a
     * local database whose name contains "test", so a mis-set .env can never hit production.
     */
    private function assertSafeTestDatabase(): void
    {
        $config = DB::connection()->getConfig();
        $database = (string) ($config['database'] ?? '');
        $host = (string) ($config['host'] ?? '');
        if (! str_contains(strtolower($database), 'test') || ! in_array($host, ['127.0.0.1', 'localhost', '::1'], true)) {
            throw new RuntimeException("Refusing to run tests against database '{$database}' on '{$host}': use a local *test* database.");
        }
    }
}
