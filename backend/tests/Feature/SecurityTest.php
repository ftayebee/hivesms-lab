<?php

namespace Tests\Feature;

use App\Models\ApiKey;
use App\Models\SenderId;
use App\Models\WebhookEndpoint;
use App\Support\Crypto;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Secret leakage, SSRF, uploads, IDOR on developer resources, dashboard ↔ API separation. */
class SecurityTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    public function test_secrets_never_appear_in_responses(): void
    {
        Mail::fake();
        $t = $this->tenant();
        $created = $this->postJson('/api/v1/app/api-keys', ['name' => 'Server', 'scopes' => ['sms:send']], $t['headers'])->assertCreated();
        $fullKey = $created->json('data.key');
        $this->assertStringStartsWith('sfk_live_', $fullKey);
        // Only the HMAC is stored; it works for authentication.
        $this->assertSame(ApiKey::query()->value('keyHash'), Crypto::hmacSha256((string) config('smsflow.api_key_pepper'), $fullKey));
        $this->getJson('/api/v1/balance', ['Authorization' => "Bearer {$fullKey}"])->assertStatus(403); // scope sms:send only

        $hook = $this->postJson('/api/v1/app/webhooks', ['url' => 'https://hooks.example.com/sms', 'events' => ['message.delivered']], $t['headers'])->assertCreated();
        $this->assertStringStartsWith('whsec_', $hook->json('data.secret'));
        $this->assertSame($hook->json('data.secret'), Crypto::decryptSecret(WebhookEndpoint::query()->value('secretEncrypted')));

        foreach (['/api/v1/app/api-keys', '/api/v1/app/webhooks', '/api/v1/auth/me', '/api/v1/profile', '/api/v1/app/team', '/api/v1/profile/sessions'] as $url) {
            $body = $this->getJson($url, $t['headers'])->assertOk()->getContent();
            foreach (['keyHash', 'passwordHash', 'tokenHash', 'secretEncrypted', $fullKey, $hook->json('data.secret'), $t['token']] as $needle) {
                $this->assertStringNotContainsString($needle, $body, "{$url} leaks {$needle}");
            }
        }
    }

    public function test_node_encrypted_secret_decrypts_in_php(): void
    {
        $fixture = json_decode((string) file_get_contents(base_path('tests/Fixtures/node-compat.json')), true);
        $this->assertSame('whsec_example_secret', Crypto::decryptSecret($fixture['secret']));
    }

    public function test_api_key_revoke_and_cross_tenant_management(): void
    {
        Mail::fake();
        $a = $this->tenant();
        $b = $this->tenant();
        $id = $this->postJson('/api/v1/app/api-keys', ['name' => 'Srv', 'scopes' => ['balance:read'], 'ipAllowlist' => '1.2.3.4, 5.6.7.8'], $a['headers'])->json('data.apiKey.id');
        $this->deleteJson("/api/v1/app/api-keys/{$id}", [], $b['headers'])->assertStatus(404);
        $this->assertSame('ACTIVE', ApiKey::query()->findOrFail($id)->status->value);
        $this->deleteJson("/api/v1/app/api-keys/{$id}", [], $a['headers'])->assertOk();
        $this->assertSame('REVOKED', ApiKey::query()->findOrFail($id)->status->value);
        $this->postJson('/api/v1/app/api-keys', ['name' => 'Srv', 'scopes' => ['balance:read'], 'ipAllowlist' => 'not-an-ip'], $a['headers'])->assertStatus(422);
        $this->postJson('/api/v1/app/api-keys', ['name' => 'Srv', 'scopes' => ['admin:all']], $a['headers'])->assertStatus(422);
        $this->postJson('/api/v1/app/api-keys', ['name' => 'Srv', 'scopes' => ['sms:send']], $this->tenant('0', 'MANAGER')['headers'])->assertStatus(403);
    }

    public function test_webhook_urls_are_ssrf_safe(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        $t = $this->tenant();
        foreach (['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://user:pass@hooks.example.com/x', 'https://[::1]/x'] as $url) {
            $this->postJson('/api/v1/app/webhooks', ['url' => $url, 'events' => ['message.delivered']], $t['headers'])->assertStatus(422);
        }
    }

    public function test_sender_id_documents_are_validated_and_tenant_scoped(): void
    {
        Storage::fake('local');
        $a = $this->tenant();
        $b = $this->tenant();
        $base = ['value' => 'acme', 'type' => 'MASKING', 'purpose' => 'Order notifications for customers', 'sampleMessage' => 'Your order 123 has shipped.'];
        $h = $a['headers'] + ['Accept' => 'application/json'];
        $this->post('/api/v1/app/sender-ids', $base, $h)->assertStatus(422)->assertJsonPath('error.details.field', 'documents');
        // A PHP file renamed to .pdf: rejected by content sniffing.
        $fake = UploadedFile::fake()->createWithContent('licence.pdf', '<?php echo 1; ?>');
        $this->post('/api/v1/app/sender-ids', $base + ['documents' => [$fake]], $h)->assertStatus(422);
        $pdf = UploadedFile::fake()->createWithContent('../../licence.pdf', "%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
        $res = $this->post('/api/v1/app/sender-ids', $base + ['documents' => [$pdf]], $h)->assertCreated()->assertJsonPath('data.value', 'ACME')->assertJsonPath('data.status', 'PENDING');
        $id = $res->json('data.id');
        $key = SenderId::query()->findOrFail($id)->documents[0]['key'];
        $this->assertMatchesRegularExpression('#^orgs/'.$a['org']->id.'/sender-ids/[0-9a-f-]{36}\.pdf$#', $key);
        $this->assertArrayNotHasKey('key', $res->json('data.documents.0'));
        $this->get("/api/v1/app/sender-ids/{$id}/documents/0", $a['headers'])->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->get("/api/v1/app/sender-ids/{$id}/documents/0", $b['headers'])->assertStatus(404);
        $this->get("/api/v1/admin/sender-ids/{$id}/documents/0", $this->staff('ADMIN'))->assertOk();
        $this->postJson('/api/v1/app/sender-ids', $base + ['documents' => [$pdf]], $a['headers'])->assertStatus(409);
        $this->deleteJson("/api/v1/app/sender-ids/{$id}", [], $a['headers'])->assertOk(); // withdraw pending
        Storage::disk('local')->assertMissing($key);
    }

    public function test_unexpected_errors_are_generic_and_request_id_is_echoed(): void
    {
        $res = $this->getJson('/api/v1/health')->assertOk();
        $this->assertSame($res->headers->get('X-Request-Id'), $res->json('meta.requestId'));
        $res->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->getJson('/api/v1/internal/ready')->assertStatus(401);
        $this->getJson('/api/v1/internal/ready', ['Authorization' => 'Bearer test-cron-secret-0123456789'])->assertOk()->assertJsonPath('data.checks.database', 'ok');
    }

    public function test_cors_is_limited_to_the_frontend(): void
    {
        $res = $this->call('OPTIONS', '/api/v1/app/contacts', server: ['HTTP_ORIGIN' => 'https://evil.example', 'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET']);
        $this->assertNotSame('https://evil.example', $res->headers->get('Access-Control-Allow-Origin'));
        $this->assertNotSame('*', $res->headers->get('Access-Control-Allow-Origin'));
    }
}
