<?php

namespace App\Services\Sms;

/**
 * Contract every upstream SMS gateway adapter implements (port of SmsProvider in
 * services/sms/types.ts). The send pipeline only talks to this interface: switching provider
 * means writing one adapter and registering it in SmsProviderManager.
 */
interface SmsProviderInterface
{
    public function key(): string;

    public function displayName(): string;

    /** False for scaffolding adapters that still need provider-specific verification. */
    public function verified(): bool;

    /** False when the gateway offers no reports at all: messages stay SUBMITTED and are never polled. */
    public function hasDeliveryReports(): bool;

    public function send(SendSmsInput $input): SendSmsResult;

    /**
     * @param  list<SendSmsInput>  $inputs
     * @return list<SendSmsResult> same order as $inputs
     */
    public function sendBulk(array $inputs): array;

    public function deliveryStatus(string $providerMessageId): DeliveryStatus;

    /** @return array{amount: float, currency: string, unit: string}|null */
    public function balance(): ?array;

    /** @return array{valid: bool, reason?: string} */
    public function validateSenderId(string $senderId, string $type): array;

    /** Authenticity of an inbound webhook (signature / shared secret). */
    public function verifyWebhook(WebhookRequest $request): bool;

    /** @return list<DeliveryStatus> with providerMessageId and eventKey set */
    public function parseDeliveryWebhook(WebhookRequest $request): array;

    /** @return list<InboundSms>|null null when the provider has no inbound support */
    public function parseInboundWebhook(WebhookRequest $request): ?array;
}
