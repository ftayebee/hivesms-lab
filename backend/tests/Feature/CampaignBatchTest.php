<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\Message;
use App\Models\MessageEvent;
use App\Models\Organization;
use App\Models\WalletTransaction;
use App\Services\Messaging\DispatcherService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\DeliveryStatus;
use App\Services\Sms\Providers\MockSmsProvider;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SendSmsResult;
use App\Services\Sms\SmsProviderManager;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Batch processing, pause/resume/cancel, unknown outcomes, provider response capture (docs/21). */
class CampaignBatchTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
        // Launch only queues: these tests drive the batches themselves.
        config(['smsflow.sms.inline_dispatch_max' => 0]);
    }

    /** Counts sends per recipient; outcome per recipient suffix can be overridden. */
    private function countingProvider(?callable $outcome = null): MockSmsProvider
    {
        $p = new class('') extends MockSmsProvider
        {
            /** @var array<string, int> */
            public array $sent = [];

            public $outcome = null;

            public function send(SendSmsInput $input): SendSmsResult
            {
                $this->sent[$input->to] = ($this->sent[$input->to] ?? 0) + 1;

                return $this->outcome ? ($this->outcome)($input) : SendSmsResult::accepted('prov-'.$input->reference, ['status' => 0, 'id' => 'prov-'.$input->reference, 'msisdn' => ltrim($input->to, '+'), 'apikey' => 'secret-should-not-be-stored']);
            }
        };
        $p->outcome = $outcome;
        app(SmsProviderManager::class)->fake('mock', $p);

        return $p;
    }

    private function numbers(int $n): string
    {
        return implode("\n", array_map(fn ($i) => '017'.str_pad((string) (10000000 + $i), 8, '0', STR_PAD_LEFT), range(1, $n)));
    }

    private function launch(array $t, int $n, int $batchSize): Campaign
    {
        $id = $this->postJson('/api/v1/app/campaigns/submit', ['name' => 'Big', 'smsType' => 'TRANSACTIONAL', 'message' => 'Hello', 'numbers' => $this->numbers($n), 'batchSize' => $batchSize], $t['headers'])
            ->assertStatus(202)->assertJsonPath('data.status', 'SCHEDULED')->json('data.id');

        return Campaign::query()->findOrFail($id); // LaunchCampaignJob ran synchronously (queue=sync)
    }

    public function test_only_permitted_batch_sizes_are_accepted(): void
    {
        $t = $this->tenant('100');
        $this->postJson('/api/v1/app/campaigns/estimate', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => '01712345678', 'batchSize' => 37], $t['headers'])
            ->assertStatus(422)->assertJsonPath('error.details.field', 'batchSize');
        $this->postJson('/api/v1/app/campaigns/estimate', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => $this->numbers(25), 'batchSize' => 10], $t['headers'])
            ->assertOk()->assertJsonPath('data.batchSize', 10)->assertJsonPath('data.batches', 3);
        $this->postJson('/api/v1/app/campaigns/estimate', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => '01712345678'], $t['headers'])
            ->assertOk()->assertJsonPath('data.batchSize', 100);
    }

    public function test_batch_size_10_sends_in_numbered_batches_and_charges_once(): void
    {
        $t = $this->tenant('100');
        $p = $this->countingProvider();
        $c = $this->launch($t, 25, 10);
        $this->assertSame('PROCESSING', $c->status->value);
        $d = app(DispatcherService::class);

        $r = $d->processCampaignBatches(1);
        $this->assertSame([1, 10], [$r['batches'], $r['claimed']]);
        $this->assertSame(10, Message::query()->where('campaignId', $c->id)->where('batchNumber', 1)->count());
        $d->processCampaignBatches(5);
        $this->assertSame(3, $c->refresh()->currentBatch);
        $this->assertSame(5, Message::query()->where('campaignId', $c->id)->where('batchNumber', 3)->count());
        $this->assertSame(25, array_sum($p->sent));
        $this->assertSame([1], array_values(array_unique($p->sent)));
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'SMS_CHARGE')->where('referenceId', $c->id)->count());
        $this->getJson("/api/v1/app/campaigns/{$c->id}/progress", $t['headers'])->assertOk()
            ->assertJsonPath('data.progress.total', 25)->assertJsonPath('data.progress.accepted', 25)->assertJsonPath('data.progress.pending', 0)
            ->assertJsonPath('data.progress.currentBatch', 3)->assertJsonPath('data.progress.totalBatches', 3)->assertJsonPath('data.progress.percent', 100);
    }

    public function test_batch_size_100(): void
    {
        $t = $this->tenant('1000');
        $this->countingProvider();
        $c = $this->launch($t, 150, 100);
        $r = app(DispatcherService::class)->processCampaignBatches(1);
        $this->assertSame(100, $r['claimed']);
        app(DispatcherService::class)->processCampaignBatches(1);
        $this->assertSame([2, 50], [$c->refresh()->currentBatch, Message::query()->where('campaignId', $c->id)->where('batchNumber', 2)->count()]);
    }

    public function test_pause_stops_new_batches_and_resume_continues_without_resending_or_recharging(): void
    {
        $t = $this->tenant('100');
        $p = $this->countingProvider();
        $c = $this->launch($t, 30, 10);
        $d = app(DispatcherService::class);
        $d->processCampaignBatches(1);
        $this->postJson("/api/v1/app/campaigns/{$c->id}/pause", [], $t['headers'])->assertOk();
        $this->assertNotNull($c->refresh()->pausedById);
        $this->assertSame(0, $d->processCampaignBatches(5)['claimed']);
        $this->assertSame(10, array_sum($p->sent));
        $this->assertSame(20, Message::query()->where('campaignId', $c->id)->where('status', 'QUEUED')->count());

        $this->postJson("/api/v1/app/campaigns/{$c->id}/resume", [], $t['headers'])->assertOk();
        $d->processCampaignBatches(10);
        $this->assertSame(30, array_sum($p->sent));
        $this->assertSame([1], array_values(array_unique($p->sent))); // nobody received it twice
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'SMS_CHARGE')->where('referenceId', $c->id)->count());
    }

    public function test_pause_during_a_batch_finishes_in_flight_chunk_and_releases_the_rest(): void
    {
        $t = $this->tenant('100');
        config(['smsflow.campaign_processing.providerConcurrency' => ['default' => 5, 'mock' => 5]]);
        app(SettingsService::class)->clearCache();
        $campaignId = null;
        $p = $this->countingProvider(function (SendSmsInput $i) use (&$campaignId) {
            // The customer pauses while the first chunk is at the provider.
            Campaign::query()->whereKey($campaignId)->update(['status' => 'PAUSED']);

            return SendSmsResult::accepted('p-'.$i->reference);
        });
        $c = $this->launch($t, 10, 10);
        $campaignId = $c->id;
        $r = app(DispatcherService::class)->processCampaignBatches(1);
        $this->assertSame([10, 5, 5], [$r['claimed'], $r['submitted'], $r['released']]);
        $this->assertSame(5, Message::query()->where('campaignId', $c->id)->where('status', 'SUBMITTED')->count());
        $this->assertSame(5, Message::query()->where('campaignId', $c->id)->where('status', 'QUEUED')->whereNull('provider')->whereNull('lockedUntil')->count());
        $this->assertCount(5, $p->sent);
    }

    public function test_cancel_refunds_only_never_sent_messages_and_keeps_history(): void
    {
        $t = $this->tenant('100');
        $this->countingProvider();
        $c = $this->launch($t, 20, 10);
        $this->assertSame('92.0000', $this->balance($t['org']));
        app(DispatcherService::class)->processCampaignBatches(1);
        $this->postJson("/api/v1/app/campaigns/{$c->id}/cancel", ['reason' => 'Wrong list'], $t['headers'])->assertOk();
        $c->refresh();
        $this->assertSame(['CANCELLED', 'Wrong list', $t['user']->id], [$c->status->value, $c->cancelReason, $c->cancelledById]);
        $this->assertSame(10, Message::query()->where('campaignId', $c->id)->where('status', 'SUBMITTED')->count());
        $this->assertSame(10, Message::query()->where('campaignId', $c->id)->where('status', 'CANCELLED')->whereNotNull('refundedAt')->count());
        $this->assertSame('96.0000', $this->balance($t['org']));
    }

    public function test_cancel_never_touches_in_flight_messages(): void
    {
        $t = $this->tenant('100');
        $c = $this->launch($t, 3, 10);
        $ids = app(DispatcherService::class)->claim(10, null, $c->id);
        Message::query()->whereIn('id', $ids)->update(['provider' => 'mock']); // at the provider right now
        $this->postJson("/api/v1/app/campaigns/{$c->id}/cancel", [], $t['headers'])->assertOk();
        $this->assertSame(3, Message::query()->where('campaignId', $c->id)->where('status', 'QUEUED')->count());
        $this->assertNull(WalletTransaction::query()->where('reason', 'REFUND')->first());
    }

    public function test_unconfirmed_outcome_is_unknown_never_resent_never_refunded_then_staff_resolve(): void
    {
        $t = $this->tenant('100');
        $p = $this->countingProvider(fn (SendSmsInput $i) => SendSmsResult::unconfirmed('PROVIDER_TIMEOUT', 'The SMS provider did not answer in time.'));
        $c = $this->launch($t, 2, 10);
        $r = app(DispatcherService::class)->processCampaignBatches(3);
        $this->assertSame(2, $r['unknown']);
        $this->assertSame(2, Message::query()->where('campaignId', $c->id)->where('status', 'UNKNOWN')->count());
        $this->assertSame(2, $c->refresh()->unknownCount);
        $this->travel(3)->hours();
        app(DispatcherService::class)->processCampaignBatches(3);
        $this->assertSame(2, array_sum($p->sent)); // never resent
        $this->assertSame('99.2000', $this->balance($t['org'])); // never auto-refunded
        // Cancelling never refunds an unconfirmed outcome either.
        $this->postJson("/api/v1/app/campaigns/{$c->id}/cancel", [], $t['headers'])->assertOk();
        $this->assertSame('99.2000', $this->balance($t['org']));
        $this->assertSame(2, Message::query()->where('campaignId', $c->id)->where('status', 'UNKNOWN')->count());

        [$a, $b] = Message::query()->where('campaignId', $c->id)->orderBy('id')->pluck('id')->all();
        $this->postJson("/api/v1/admin/messages/{$a}/resolve", ['outcome' => 'failed', 'refund' => true, 'reason' => 'Provider report: not sent'], $this->staff('ADMIN'))->assertForbidden();
        $super = $this->staff('SUPER_ADMIN');
        $this->getJson('/api/v1/admin/messages/unconfirmed', $super)->assertOk()->assertJsonPath('meta.total', 2);
        $this->postJson("/api/v1/admin/messages/{$a}/resolve", ['outcome' => 'failed', 'refund' => true, 'reason' => 'Provider report: not sent'], $super)->assertOk()->assertJsonPath('data.refunded', true);
        $this->postJson("/api/v1/admin/messages/{$a}/resolve", ['outcome' => 'failed', 'refund' => true, 'reason' => 'again'], $super)->assertStatus(409);
        $this->postJson("/api/v1/admin/messages/{$b}/resolve", ['outcome' => 'delivered', 'reason' => 'Provider report: delivered'], $super)->assertOk();
        $this->assertSame('99.6000', $this->balance($t['org']));
        $this->assertSame([0, 1], [$c->refresh()->unknownCount, $c->deliveredCount]);
    }

    public function test_interrupted_send_becomes_unknown_without_refund(): void
    {
        $t = $this->tenant('100');
        $p = $this->countingProvider();
        $c = $this->launch($t, 1, 10);
        $ids = app(DispatcherService::class)->claim(10, null, $c->id);
        Message::query()->whereIn('id', $ids)->update(['provider' => 'mock']); // worker died mid-request
        $this->travel(10)->minutes();
        app(DispatcherService::class)->processCampaignBatches(2);
        $m = Message::query()->findOrFail($ids[0]);
        $this->assertSame(['UNKNOWN', 'SEND_INTERRUPTED'], [$m->status->value, $m->errorCode]);
        $this->assertNull($m->refundedAt);
        $this->assertSame([], $p->sent);
    }

    public function test_provider_response_is_persisted_immediately_and_redacted(): void
    {
        $t = $this->tenant('100');
        $this->countingProvider();
        $c = $this->launch($t, 1, 10);
        app(DispatcherService::class)->processCampaignBatches(1);
        $m = Message::query()->where('campaignId', $c->id)->firstOrFail();
        $this->assertSame(['SUBMITTED', 'ACCEPTED', 'prov-'.$m->id], [$m->status->value, $m->providerStatusCode, $m->providerMessageId]);
        $this->assertNotNull($m->providerRequestedAt);
        $this->assertNotNull($m->providerRespondedAt);
        $this->assertSame('[redacted]', $m->providerResponse['apikey']);
        $this->assertSame('**********001', $m->providerResponse['msisdn']);
        $event = MessageEvent::query()->where('messageId', $m->id)->where('status', 'SUBMITTED')->firstOrFail();
        $this->assertSame('[redacted]', $event->payload['apikey']);
        // Accepted is not delivered.
        $this->assertNull($m->deliveredAt);
        // The customer sees the provider reference and code, not the raw response.
        $this->getJson("/api/v1/app/campaigns/{$c->id}/messages", $t['headers'])->assertOk()
            ->assertJsonPath('data.0.providerReference', 'prov-'.$m->id)->assertJsonPath('data.0.providerStatusCode', 'ACCEPTED')->assertJsonMissingPath('data.0.providerResponse');
    }

    public function test_reports_never_call_the_provider(): void
    {
        $t = $this->tenant('100');
        $p = new class('') extends MockSmsProvider
        {
            public int $calls = 0;

            public function deliveryStatus(string $providerMessageId): DeliveryStatus
            {
                $this->calls++;

                return parent::deliveryStatus($providerMessageId);
            }

            public function balance(): ?array
            {
                $this->calls++;

                return null;
            }
        };
        app(SmsProviderManager::class)->fake('mock', $p);
        $c = $this->launch($t, 3, 10);
        app(DispatcherService::class)->processCampaignBatches(1);
        $this->getJson('/api/v1/app/reports/messages', $t['headers'])->assertOk();
        $this->getJson('/api/v1/app/reports/campaigns', $t['headers'])->assertOk();
        $this->getJson("/api/v1/app/campaigns/{$c->id}", $t['headers'])->assertOk();
        $this->get('/api/v1/app/reports/export', $t['headers'])->assertOk();
        $this->assertSame(0, $p->calls);
    }

    public function test_concurrent_workers_never_double_send(): void
    {
        $t = $this->tenant('100');
        $p = $this->countingProvider();
        $c = $this->launch($t, 20, 10);
        // Two dispatcher instances (two workers) claim the same campaign.
        $w1 = app()->make(DispatcherService::class);
        $w2 = app()->make(DispatcherService::class);
        $a = $w1->claim(10, null, $c->id);
        $b = $w2->claim(10, null, $c->id);
        $this->assertSame([], array_intersect($a, $b));
        $w1->dispatch($a);
        $w2->dispatch($b);
        $w1->processCampaignBatches(5);
        $this->assertSame(20, array_sum($p->sent));
        $this->assertSame([1], array_values(array_unique($p->sent)));
    }

    public function test_suspended_accounts_are_not_processed(): void
    {
        $t = $this->tenant('100');
        $p = $this->countingProvider();
        $c = $this->launch($t, 5, 10);
        Organization::query()->whereKey($t['org']->id)->update(['status' => 'SUSPENDED']);
        app(DispatcherService::class)->processCampaignBatches(5);
        $this->assertSame([], $p->sent);
        $this->assertSame('PROCESSING', $c->refresh()->status->value);
    }
}
