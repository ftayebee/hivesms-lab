<?php

namespace App\Http\Controllers\Api\V1\ApiKeys;

use App\Auth\Permissions;
use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Developers\ApiKeyRequest;
use App\Http\Requests\Developers\WebhookEndpointRequest;
use App\Http\Resources\ApiKeyResource;
use App\Http\Resources\ApiLogResource;
use App\Http\Resources\WebhookEndpointResource;
use App\Services\ApiKey\ApiKeyService;
use App\Services\ApiKey\WebhookEndpointService;
use App\Services\Messaging\OutboundWebhookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Developers area: API keys, request logs, customer webhook endpoints. */
class ApiKeyController extends ApiController
{
    public function __construct(private readonly ApiKeyService $keys, private readonly WebhookEndpointService $webhooks) {}

    public function index(Request $request): JsonResponse
    {
        return $this->collection($request, ApiKeyResource::class, $this->keys->list($this->tenant($request)), ['scopes' => Permissions::API_SCOPES]);
    }

    /** The full key is in the response exactly once; only its HMAC is stored. */
    public function store(ApiKeyRequest $request): JsonResponse
    {
        ['key' => $key, 'fullKey' => $fullKey] = $this->keys->create($this->tenant($request), $request->payload());

        return $this->ok(['apiKey' => (new ApiKeyResource($key))->resolve($request), 'key' => $fullKey], 201);
    }

    /** DELETE /app/api-keys/{id}: revoke (kept for the audit trail and logs). */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->keys->revoke($this->tenant($request), $id);

        return $this->ok(['revoked' => true, 'message' => 'Key revoked. Requests using it are rejected from now on.']);
    }

    /** GET /app/api-logs?status=2xx|4xx|5xx&keyId=&page= (+ last-24h stats). */
    public function logs(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:2xx,4xx,5xx'], 'keyId' => ['nullable', 'uuid']]);
        $r = $this->keys->logs($this->tenant($request), $this->page($request), $q['status'] ?? null, $q['keyId'] ?? null);

        return $this->paginated($request, $r['page'], ApiLogResource::class, ['stats' => $r['stats']]);
    }

    // ─── Webhook endpoints ───

    public function webhooks(Request $request): JsonResponse
    {
        return $this->collection($request, WebhookEndpointResource::class, $this->webhooks->list($this->tenant($request)), ['events' => OutboundWebhookService::EVENTS]);
    }

    /** The signing secret is in the response exactly once (stored encrypted). */
    public function storeWebhook(WebhookEndpointRequest $request): JsonResponse
    {
        ['endpoint' => $ep, 'secret' => $secret] = $this->webhooks->create($this->tenant($request), $request->payload());

        return $this->ok(['webhook' => (new WebhookEndpointResource($ep))->resolve($request), 'secret' => $secret], 201);
    }

    public function updateWebhook(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['active' => ['required', 'boolean']]);
        $this->webhooks->toggle($this->tenant($request), $id, (bool) $data['active']);

        return $this->ok(['active' => (bool) $data['active']]);
    }

    public function destroyWebhook(Request $request, string $id): JsonResponse
    {
        $this->webhooks->delete($this->tenant($request), $id);

        return $this->ok(['deleted' => true]);
    }

    public function testWebhook(Request $request, string $id): JsonResponse
    {
        $this->webhooks->sendTest($this->tenant($request), $id);

        return $this->ok(['message' => 'Test event queued. It is delivered within a minute.'], 202);
    }
}
