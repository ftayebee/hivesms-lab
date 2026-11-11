<?php

namespace Tests\Feature;

use App\Models\ProviderSenderId;
use App\Models\SenderId;
use App\Services\Platform\SettingsService;
use App\Services\Sms\ProviderResponseRedactor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Provider sender catalog and multi-customer assignment (docs/22 §5). */
class SenderCatalogTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['smsflow.features.sender_catalog' => true]);
        Mail::fake();
    }

    public function test_sync_from_provider_and_assign_to_several_customers(): void
    {
        $sa = $this->staff('SUPER_ADMIN');
        $this->postJson('/api/v1/admin/sender-catalog/sync', [], $this->staff('ADMIN'))->assertForbidden();
        $this->postJson('/api/v1/admin/sender-catalog/sync', [], $sa)->assertOk()->assertJsonPath('data.added', 3);
        $this->postJson('/api/v1/admin/sender-catalog/sync', [], $sa)->assertOk()->assertJsonPath('data.added', 0)->assertJsonPath('data.updated', 3);
        $entry = ProviderSenderId::query()->where('value', 'MOCKSHOP')->firstOrFail();

        $a = $this->tenant();
        $b = $this->tenant();
        $this->putJson("/api/v1/admin/sender-catalog/{$entry->id}/assignments", ['organizationIds' => [$a['org']->id, $b['org']->id]], $sa)->assertOk();
        foreach ([$a, $b] as $t) {
            $s = SenderId::query()->where('organizationId', $t['org']->id)->where('value', 'MOCKSHOP')->firstOrFail();
            $this->assertSame(['APPROVED', true], [$s->status->value, $s->isDefault]);
        }
        // Usable when sending.
        $this->postJson('/api/v1/app/campaigns/estimate', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => '01712345678', 'senderId' => 'MOCKSHOP'], $a['headers'])->assertOk()->assertJsonPath('data.senderValue', 'MOCKSHOP');

        // Removing B suspends only B's row.
        $this->putJson("/api/v1/admin/sender-catalog/{$entry->id}/assignments", ['organizationIds' => [$a['org']->id]], $sa)->assertOk()->assertJsonPath('data.unassigned', [$b['org']->id]);
        $this->assertSame('SUSPENDED', SenderId::query()->where('organizationId', $b['org']->id)->where('value', 'MOCKSHOP')->value('status')->value);
        $list = collect($this->getJson('/api/v1/admin/sender-catalog', $sa)->assertOk()->json('data'))->keyBy('value');
        $this->assertSame([$a['org']->id], array_column($list['MOCKSHOP']['assignments'], 'organizationId'));
    }

    public function test_manual_entries_for_providers_without_a_listing_api(): void
    {
        config(['smsflow.sms.provider' => 'automas', 'smsflow.sms.provider_api_key' => 'k']);
        app(SettingsService::class)->clearCache();
        $sa = $this->staff('SUPER_ADMIN');
        $this->postJson('/api/v1/admin/sender-catalog/sync', [], $sa)->assertStatus(403)->assertJsonPath('error.code', 'FEATURE_DISABLED');
        $this->postJson('/api/v1/admin/sender-catalog', ['value' => 'MYBRAND', 'type' => 'MASKING'], $sa)->assertCreated();
        $this->postJson('/api/v1/admin/sender-catalog', ['value' => 'MYBRAND', 'type' => 'MASKING'], $sa)->assertStatus(409);
        $this->postJson('/api/v1/admin/sender-catalog', ['value' => '!!', 'type' => 'MASKING'], $sa)->assertStatus(422);
    }

    public function test_redactor_removes_secrets_and_masks_phones(): void
    {
        $r = ProviderResponseRedactor::summarize(['response' => [['status' => 0, 'id' => 1, 'msisdn' => '8801712345678']], 'api_key' => 'x', 'note' => 'sent to 01712345678']);
        $this->assertSame('[redacted]', $r['api_key']);
        $this->assertSame('**********678', $r['response'][0]['msisdn']);
        $this->assertSame('sent to ********678', $r['note']);
        $big = ProviderResponseRedactor::summarize(str_repeat('a', 5000));
        $this->assertLessThanOrEqual(ProviderResponseRedactor::MAX_BYTES, strlen(json_encode($big)));
    }
}
