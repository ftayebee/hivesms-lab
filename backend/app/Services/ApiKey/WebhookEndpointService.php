<?php

namespace App\Services\ApiKey;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Services\Platform\AuditLogger;
use App\Support\Crypto;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\SafeUrl;
use Illuminate\Database\Eloquent\Collection;

/** Customer webhook endpoints (port of the webhook part of features/developers/service.ts). */
class WebhookEndpointService
{
    private const MAX_ENDPOINTS = 10;

    public function __construct(private readonly AuditLogger $audit) {}

    /** @return Collection<int, WebhookEndpoint> */
    public function list(TenantContext $ctx): Collection
    {
        $ctx->requirePermission('api_keys:read');
        $endpoints = WebhookEndpoint::query()->where('organizationId', $ctx->organizationId)->orderByDesc('createdAt')->get();
        // Last 5 deliveries per endpoint: one small query each (at most 10 endpoints).
        foreach ($endpoints as $ep) {
            $ep->setRelation('deliveries', WebhookDelivery::query()->where('endpointId', $ep->id)->orderByDesc('createdAt')->limit(5)
                ->get(['id', 'endpointId', 'event', 'status', 'responseStatus', 'attempts', 'createdAt']));
        }

        return $endpoints;
    }

    /**
     * @param  array{url: string, description: ?string, events: list<string>}  $input
     * @return array{endpoint: WebhookEndpoint, secret: string}
     */
    public function create(TenantContext $ctx, array $input): array
    {
        $ctx->requirePermission('api_keys:manage');
        SafeUrl::assertAcceptable($input['url']);
        if (WebhookEndpoint::query()->where('organizationId', $ctx->organizationId)->count() >= self::MAX_ENDPOINTS) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'You can register at most 10 webhook endpoints.');
        }
        $secret = 'whsec_'.Crypto::randomToken(24);
        $ep = WebhookEndpoint::query()->forceCreate([
            'organizationId' => $ctx->organizationId, 'url' => $input['url'], 'description' => $input['description'],
            'events' => array_values($input['events']), 'secretEncrypted' => Crypto::encryptSecret($secret),
        ]);
        $this->audit->log('webhook.create', $ctx->actor(), $ctx->organizationId, 'webhook', $ep->id, ['url' => $input['url'], 'events' => $input['events']]);

        return ['endpoint' => $ep, 'secret' => $secret];
    }

    private function own(TenantContext $ctx, string $id): WebhookEndpoint
    {
        return WebhookEndpoint::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Webhook not found.');
    }

    public function toggle(TenantContext $ctx, string $id, bool $active): void
    {
        $ctx->requirePermission('api_keys:manage');
        $ep = $this->own($ctx, $id);
        $ep->forceFill(['active' => $active] + ($active ? ['failureCount' => 0] : []))->save();
        $this->audit->log($active ? 'webhook.enable' : 'webhook.disable', $ctx->actor(), $ctx->organizationId, 'webhook', $id);
    }

    public function delete(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('api_keys:manage');
        $this->own($ctx, $id)->delete();
        $this->audit->log('webhook.delete', $ctx->actor(), $ctx->organizationId, 'webhook', $id);
    }

    /** Queues a sample event so customers can test their endpoint. */
    public function sendTest(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('api_keys:manage');
        $ep = $this->own($ctx, $id);
        $now = Dhaka::iso(now());
        WebhookDelivery::query()->forceCreate([
            'endpointId' => $ep->id,
            'event' => 'message.delivered',
            'payload' => [
                'event' => 'message.delivered', 'created_at' => $now, 'test' => true,
                'data' => ['message_id' => '00000000-0000-0000-0000-000000000000', 'to' => '+8801XXXXXXXXX', 'status' => 'delivered', 'segments' => 1, 'cost' => '0.35', 'refunded' => false, 'client_reference' => 'test', 'campaign_id' => null, 'occurred_at' => $now],
            ],
            'nextAttemptAt' => now(),
        ]);
    }
}
