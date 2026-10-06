<?php

namespace Tests\Feature;

use App\Exceptions\AppException;
use App\Support\ErrorCode;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

class ApiEnvelopeTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Route::prefix('api/v1/_test')->group(function (): void {
            Route::post('validate', fn (Request $r) => $r->validate(['phone' => ['required', 'string']]));
            Route::get('app-error', fn () => throw new AppException(ErrorCode::CONFLICT, 'Already exists.', ['field' => 'email']));
            Route::get('hidden-error', fn () => throw new AppException(ErrorCode::FORBIDDEN, 'internal detail', null, false));
            Route::get('crash', fn () => throw new RuntimeException('SQLSTATE[42S02] secret table users_x'));
            Route::get('throttled', fn () => 'ok')->middleware('throttle:1,1');
        });
    }

    public function test_health_returns_success_envelope_with_request_id(): void
    {
        $res = $this->getJson('/api/v1/health');

        $res->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'ok')
            ->assertJsonPath('data.database', 'ok');
        $id = $res->json('meta.requestId');
        $this->assertMatchesRegularExpression('/^req_[A-Za-z0-9]{16}$/', $id);
        $res->assertHeader('X-Request-Id', $id);
        $this->assertStringContainsString('no-store', $res->headers->get('Cache-Control'));
    }

    public function test_unknown_endpoint_is_404_envelope_even_without_json_accept_header(): void
    {
        $this->get('/api/v1/does-not-exist')
            ->assertStatus(404)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error.code', 'NOT_FOUND');
    }

    public function test_wrong_method_is_405(): void
    {
        $this->postJson('/api/v1/health')->assertStatus(405)->assertJsonPath('error.code', 'INVALID_REQUEST');
    }

    public function test_validation_errors_use_the_same_details_shape_as_the_node_api(): void
    {
        $this->postJson('/api/v1/_test/validate', [])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'VALIDATION_ERROR')
            ->assertJsonPath('error.message', 'The request is invalid.')
            ->assertJsonPath('error.details.fields.0.path', 'phone');
    }

    public function test_app_exception_keeps_code_message_and_details(): void
    {
        $this->getJson('/api/v1/_test/app-error')
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'CONFLICT')
            ->assertJsonPath('error.message', 'Already exists.')
            ->assertJsonPath('error.details.field', 'email');
    }

    public function test_non_exposed_app_exception_hides_its_message(): void
    {
        $this->getJson('/api/v1/_test/hidden-error')
            ->assertStatus(403)
            ->assertJsonPath('error.message', 'The request could not be completed.');
    }

    public function test_unexpected_errors_never_leak_internals_even_with_debug_on(): void
    {
        config(['app.debug' => true]);

        $res = $this->getJson('/api/v1/_test/crash');

        $res->assertStatus(500)->assertJsonPath('error.code', 'INTERNAL_ERROR');
        $this->assertStringNotContainsString('SQLSTATE', $res->getContent());
        $this->assertStringNotContainsString('trace', $res->getContent());
    }

    public function test_rate_limit_is_429_envelope_with_retry_after(): void
    {
        $this->getJson('/api/v1/_test/throttled')->assertOk();
        $this->getJson('/api/v1/_test/throttled')
            ->assertStatus(429)
            ->assertJsonPath('error.code', 'RATE_LIMITED')
            ->assertHeader('Retry-After');
    }

    public function test_cors_allows_only_the_frontend_origin(): void
    {
        $preflight = fn (string $origin) => $this->call('OPTIONS', '/api/v1/health', server: [
            'HTTP_ORIGIN' => $origin,
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
        ]);

        $this->assertSame('http://localhost:3000', $preflight('http://localhost:3000')->headers->get('Access-Control-Allow-Origin'));
        // With a single allowed origin the header is static; a browser on another origin sees a
        // mismatch and blocks the response. A foreign origin must never be echoed back.
        $this->assertNotSame('https://evil.example', $preflight('https://evil.example')->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_cors_with_several_frontend_origins_only_echoes_listed_ones(): void
    {
        config(['cors.allowed_origins' => ['https://sms.hivelabsbd.com', 'http://localhost:3000']]);
        $preflight = fn (string $origin) => $this->call('OPTIONS', '/api/v1/health', server: [
            'HTTP_ORIGIN' => $origin,
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
        ]);

        $this->assertSame('https://sms.hivelabsbd.com', $preflight('https://sms.hivelabsbd.com')->headers->get('Access-Control-Allow-Origin'));
        $this->assertNull($preflight('https://evil.example')->headers->get('Access-Control-Allow-Origin'));
    }
}
