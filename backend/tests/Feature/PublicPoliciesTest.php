<?php

namespace Tests\Feature;

use App\Services\Platform\SettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** GET /public/policies: what the Next.js panel reads instead of its own database. */
class PublicPoliciesTest extends TestCase
{
    use RefreshDatabase;

    public function test_returns_customer_facing_policies_without_internal_or_secret_values(): void
    {
        app(SettingsService::class)->set('sms.policy', ['segmentation' => ['maxSegments' => 7], 'reviewThresholdRecipients' => 99, 'maxAttempts' => 9]);
        app(SettingsService::class)->clearCache();

        $r = $this->getJson('/api/v1/public/policies')->assertOk();
        $sms = $r->json('data')['sms.policy'];
        $this->assertSame([7, 160], [$sms['segmentation']['maxSegments'], $sms['segmentation']['gsm7']['single']]);
        $this->assertEquals(15, $r->json('data')['billing.policy']['vatRatePercent']);
        $this->assertArrayNotHasKey('reviewThresholdRecipients', $sms);
        $this->assertArrayNotHasKey('maxAttempts', $sms);
        $this->assertStringNotContainsString('apiKey', (string) $r->getContent());
    }
}
