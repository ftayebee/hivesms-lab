<?php

namespace App\Http\Controllers\Api\V1\Webhooks;

use App\Http\Controllers\Controller;
use App\Services\Messaging\InboundService;
use App\Services\Sms\SmsProviderManager;
use App\Services\Sms\WebhookRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Provider → platform webhooks (plain JSON answers, as providers expect; not the envelope).
 * The adapter verifies authenticity (HMAC signature / shared secret, constant-time) BEFORE anything
 * is parsed or applied; unsigned webhooks are rejected in production. Processing is idempotent.
 */
class SmsWebhookController extends Controller
{
    public function __construct(private readonly SmsProviderManager $providers, private readonly InboundService $inbound) {}

    /** POST /api/v1/webhooks/sms/{provider}: delivery reports. 5xx makes providers retry; replays are ignored. */
    public function delivery(Request $request, string $provider): JsonResponse
    {
        if (! $this->providers->has($provider)) {
            return response()->json(['error' => 'unknown provider'], 404);
        }
        if (strlen((string) $request->getContent()) > 2000000) {
            return response()->json(['error' => 'payload too large'], 413);
        }
        $adapter = $this->providers->provider($provider);
        $wr = WebhookRequest::fromRequest($request);
        if (! $adapter->verifyWebhook($wr)) {
            Log::warning('rejected delivery webhook with invalid signature', ['provider' => $provider, 'ip' => $request->ip()]);

            return response()->json(['error' => 'invalid signature'], 401);
        }
        try {
            return response()->json(['ok' => true] + $this->inbound->processDeliveryEvents($provider, $adapter->parseDeliveryWebhook($wr), true));
        } catch (Throwable $e) {
            Log::error('delivery webhook processing failed', ['provider' => $provider, 'error' => $e->getMessage()]);

            return response()->json(['ok' => false], 500);
        }
    }

    /** POST /api/v1/webhooks/sms/{provider}/inbound: inbound SMS (opt-out keywords such as STOP). */
    public function inbound(Request $request, string $provider): JsonResponse
    {
        if (! $this->providers->has($provider)) {
            return response()->json(['error' => 'unknown provider'], 404);
        }
        if (strlen((string) $request->getContent()) > 1000000) {
            return response()->json(['error' => 'payload too large'], 413);
        }
        $adapter = $this->providers->provider($provider);
        $wr = WebhookRequest::fromRequest($request);
        if (! $adapter->verifyWebhook($wr)) {
            return response()->json(['error' => 'invalid signature'], 401);
        }
        $messages = $adapter->parseInboundWebhook($wr);
        if ($messages === null) {
            return response()->json(['error' => 'inbound messages not supported by this provider'], 404);
        }
        try {
            return response()->json(['ok' => true] + $this->inbound->processInboundMessages($provider, $messages));
        } catch (Throwable $e) {
            Log::error('inbound webhook processing failed', ['provider' => $provider, 'error' => $e->getMessage()]);

            return response()->json(['ok' => false], 500);
        }
    }
}
