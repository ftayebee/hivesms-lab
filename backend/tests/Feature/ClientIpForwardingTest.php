<?php

namespace Tests\Feature;

use App\Models\RateLimitBucket;
use App\Models\Session;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * After cutover every dashboard call reaches Laravel from the Next.js server. The browser's IP is
 * forwarded in X-SMSFlow-Client-IP and honoured only with the shared FRONTEND_PROXY_SECRET, so
 * per-IP login limits and session/audit IPs keep working — and nobody else can spoof their IP.
 */
class ClientIpForwardingTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const BROWSER_IP = '198.51.100.23';

    private function login(array $headers): void
    {
        $t = $this->tenant();
        $this->postJson('/api/v1/auth/login', ['identifier' => $t['user']->email, 'password' => UserFactory::PASSWORD], $headers)->assertOk();
    }

    private function bucketFor(string $ip): bool
    {
        return RateLimitBucket::query()->where('key', 'like', "%{$ip}%")->exists();
    }

    public function test_trusted_frontend_forwards_the_browser_ip(): void
    {
        $this->login(['X-SMSFlow-Client-IP' => self::BROWSER_IP, 'X-SMSFlow-Proxy-Secret' => config('smsflow.frontend_proxy_secret')]);
        $this->assertTrue($this->bucketFor(self::BROWSER_IP));
        $this->assertSame(self::BROWSER_IP, Session::query()->latest('createdAt')->value('ipAddress'));
    }

    public function test_forwarded_ip_is_ignored_without_the_right_secret(): void
    {
        foreach ([[], ['X-SMSFlow-Proxy-Secret' => 'wrong-secret-wrong-secret-wrong-secret'], ['X-SMSFlow-Proxy-Secret' => '']] as $auth) {
            $this->login(['X-SMSFlow-Client-IP' => self::BROWSER_IP] + $auth);
        }
        $this->assertFalse($this->bucketFor(self::BROWSER_IP));
        $this->assertSame(0, Session::query()->where('ipAddress', self::BROWSER_IP)->count());
    }

    public function test_invalid_ip_or_disabled_secret_is_ignored(): void
    {
        $this->login(['X-SMSFlow-Client-IP' => 'not-an-ip', 'X-SMSFlow-Proxy-Secret' => config('smsflow.frontend_proxy_secret')]);
        $this->assertFalse($this->bucketFor('not-an-ip'));
        config(['smsflow.frontend_proxy_secret' => '']);
        $this->login(['X-SMSFlow-Client-IP' => self::BROWSER_IP, 'X-SMSFlow-Proxy-Secret' => '']);
        $this->assertFalse($this->bucketFor(self::BROWSER_IP));
    }

    public function test_login_limit_applies_per_forwarded_browser_not_to_the_shared_frontend_ip(): void
    {
        $this->tenant();
        $secret = config('smsflow.frontend_proxy_secret');
        $statuses = [];
        for ($i = 0; $i < 40; $i++) {
            // A new identifier each time: only the per-IP limit can trip (not the per-account one).
            $statuses[] = $this->postJson('/api/v1/auth/login', ['identifier' => "nobody{$i}@example.com", 'password' => 'wrong-password'], ['X-SMSFlow-Client-IP' => self::BROWSER_IP, 'X-SMSFlow-Proxy-Secret' => $secret])->status();
        }
        $this->assertContains(429, $statuses);
        // A different browser behind the same Next.js server is not locked out by the first one.
        $this->postJson('/api/v1/auth/login', ['identifier' => 'other@example.com', 'password' => 'wrong-password'], ['X-SMSFlow-Client-IP' => '198.51.100.99', 'X-SMSFlow-Proxy-Secret' => $secret])->assertStatus(401);
    }
}
