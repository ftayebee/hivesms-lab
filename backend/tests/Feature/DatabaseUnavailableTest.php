<?php

namespace Tests\Feature;

use App\Exceptions\ApiExceptionRenderer;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Route;
use PDOException;
use RuntimeException;
use Tests\TestCase;

/**
 * A refused/dropped database connection (shared-hosting connection limits under a burst) is a
 * temporary 503 with Retry-After, so the Next.js client retries GETs; real query errors stay 500.
 */
class DatabaseUnavailableTest extends TestCase
{
    private static function queryException(string $driverMessage): QueryException
    {
        return new QueryException('mysql', 'select 1', [], new PDOException($driverMessage));
    }

    public function test_connection_refusals_are_503_with_retry_after(): void
    {
        Route::get('/api/v1/__test/db-down', fn () => throw self::queryException('SQLSTATE[HY000] [2002] Operation not permitted'));
        $this->getJson('/api/v1/__test/db-down')
            ->assertStatus(503)
            ->assertHeader('Retry-After', '1')
            ->assertJsonPath('error.code', 'SERVICE_UNAVAILABLE')
            ->assertJsonMissingPath('error.details');
    }

    public function test_classification(): void
    {
        foreach (['SQLSTATE[HY000] [2002] Connection refused', 'SQLSTATE[HY000] [2006] MySQL server has gone away', 'SQLSTATE[HY000] [1040] Too many connections', 'SQLSTATE[42000] [1203] User has exceeded the max_user_connections resource', 'SQLSTATE[08S01]: Communication link failure'] as $m) {
            $this->assertTrue(ApiExceptionRenderer::databaseUnavailable(self::queryException($m)), $m);
        }
        $this->assertFalse(ApiExceptionRenderer::databaseUnavailable(self::queryException("SQLSTATE[42S22]: Column not found: 1054 Unknown column 'x'")));
        $this->assertFalse(ApiExceptionRenderer::databaseUnavailable(new RuntimeException('Connection refused')));
    }

    public function test_real_query_errors_stay_500(): void
    {
        Route::get('/api/v1/__test/bad-sql', fn () => throw self::queryException("SQLSTATE[42S22]: Column not found: 1054 Unknown column 'x'"));
        $this->getJson('/api/v1/__test/bad-sql')->assertStatus(500)->assertJsonPath('error.code', 'INTERNAL_ERROR');
    }
}
