<?php

namespace App\Services\Messaging;

use App\Models\Contact;
use App\Models\InboundWebhookEvent;
use App\Models\Message;
use App\Services\Platform\SettingsService;
use App\Services\Sms\DeliveryStatus;
use App\Services\Sms\InboundSms;
use App\Support\Phone;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Provider → platform events (port of services/messaging/inbound.ts). Each event is stored once
 * (inbound_webhook_events.eventKey is unique) and applied through the forward-only status
 * machine, so provider retries and replays are harmless and never double-count.
 */
class InboundService
{
    public function __construct(
        private readonly DeliveryService $delivery,
        private readonly SettingsService $settings,
    ) {}

    /** Records an event once; false when it was already received. */
    private function record(string $provider, string $kind, string $eventKey, mixed $payload, ?bool $signatureValid): bool
    {
        try {
            InboundWebhookEvent::query()->forceCreate([
                'provider' => $provider,
                'kind' => $kind,
                'eventKey' => mb_substr($eventKey, 0, 512),
                'signatureValid' => $signatureValid,
                'payload' => $payload ?? [],
                'status' => 'RECEIVED',
            ]);

            return true;
        } catch (UniqueConstraintViolationException) {
            return false;
        }
    }

    private function mark(string $eventKey, string $status, ?string $error = null): void
    {
        InboundWebhookEvent::query()->where('eventKey', mb_substr($eventKey, 0, 512))->update(array_filter([
            'status' => $status,
            'processedAt' => in_array($status, ['PROCESSED', 'IGNORED'], true) ? now()->format('Y-m-d H:i:s.v') : null,
            'error' => $error !== null ? mb_substr($error, 0, 500) : null,
        ], fn ($v) => $v !== null));
    }

    /**
     * @param  list<DeliveryStatus>  $events
     * @return array{received: int, applied: int}
     */
    public function processDeliveryEvents(string $provider, array $events, bool $signatureValid): array
    {
        $applied = 0;
        foreach ($events as $e) {
            if (! $e->eventKey || ! $e->providerMessageId || ! $this->record($provider, 'sms.delivery', $e->eventKey, $e->raw, $signatureValid)) {
                continue; // duplicate delivery of the same event
            }
            $msg = $this->delivery->findByProviderId($provider, $e->providerMessageId);
            if (! $msg || $e->status === 'UNKNOWN') {
                $this->mark($e->eventKey, 'IGNORED', $msg ? 'unknown status' : 'unknown message');

                continue;
            }
            try {
                $outcome = $this->delivery->apply([
                    'messageId' => $msg['id'],
                    'status' => $e->status,
                    'source' => 'PROVIDER_WEBHOOK',
                    'dedupeKey' => "wh:{$e->eventKey}",
                    'occurredAt' => $e->occurredAt,
                    'providerStatus' => $e->providerStatus,
                    'errorCode' => $e->errorCode,
                    'description' => $e->description,
                    'payload' => $e->raw,
                ]);
                if ($outcome === 'applied') {
                    $applied++;
                }
                $this->mark($e->eventKey, 'PROCESSED');
            } catch (Throwable $ex) {
                Log::error('failed to apply delivery event', ['provider' => $provider, 'eventKey' => $e->eventKey, 'error' => $ex->getMessage()]);
                $this->mark($e->eventKey, 'FAILED', $ex->getMessage());
            }
        }

        return ['received' => count($events), 'applied' => $applied];
    }

    /**
     * Opt-out keywords add the sender to the suppression list of every organization that has
     * messaged that number (the inbound number is shared; suppressing for all is the safe choice).
     *
     * @param  list<InboundSms>  $messages
     * @return array{received: int, optOuts: int}
     */
    public function processInboundMessages(string $provider, array $messages): array
    {
        $keywords = array_map(fn ($k) => mb_strtoupper(trim((string) $k)), $this->settings->smsPolicy()['optOutKeywords']);
        $optOuts = 0;
        foreach ($messages as $m) {
            if (! $this->record($provider, 'sms.inbound', $m->eventKey, ['from' => $m->from, 'to' => $m->to, 'text' => mb_substr($m->text, 0, 500)], null)) {
                continue;
            }
            $phone = Phone::normalize($m->from);
            $first = mb_strtoupper(preg_split('/\s+/u', trim($m->text))[0] ?? '');
            if (! $phone || ! in_array($first, $keywords, true)) {
                $this->mark($m->eventKey, 'IGNORED');

                continue;
            }
            $orgs = Message::query()->where('to', $phone)->distinct()->limit(100)->pluck('organizationId');
            $now = now()->format('Y-m-d H:i:s.v');
            foreach ($orgs as $organizationId) {
                DB::table('suppression_entries')->insertOrIgnore([
                    'id' => (string) Str::uuid(), 'organizationId' => $organizationId, 'phone' => $phone,
                    'reason' => 'OPT_OUT', 'source' => "{$first} reply", 'createdAt' => $now,
                ]);
                Contact::query()->where('organizationId', $organizationId)->where('phone', $phone)
                    ->update(['consentStatus' => 'OPTED_OUT', 'consentAt' => $now, 'consentSource' => "{$first} reply"]);
            }
            $optOuts++;
            Log::info('opt-out received', ['from' => Phone::mask($phone), 'orgs' => $orgs->count()]);
            $this->mark($m->eventKey, 'PROCESSED');
        }

        return ['received' => count($messages), 'optOuts' => $optOuts];
    }
}
