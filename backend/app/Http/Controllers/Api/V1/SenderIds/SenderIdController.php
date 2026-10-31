<?php

namespace App\Http\Controllers\Api\V1\SenderIds;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Messaging\SenderIdRequest;
use App\Http\Resources\SenderIdResource;
use App\Services\SenderId\SenderIdService;
use App\Services\Sms\SmsCostCalculator;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Sender IDs of the organization: request (with documents), set default, withdraw a pending
 * request, download documents. Approval/rejection/suspension is admin-only.
 */
class SenderIdController extends ApiController
{
    public function __construct(private readonly SenderIdService $senders, private readonly SmsCostCalculator $pricing) {}

    public function index(Request $request): JsonResponse
    {
        $ctx = $this->tenant($request);
        $plan = $this->pricing->planFor($ctx->organizationId);

        return $this->collection($request, SenderIdResource::class, $this->senders->list($ctx), ['senderIdFee' => Money::round((string) $plan->senderIdFee, 2)]);
    }

    /** Approved sender IDs for the composer (default first). */
    public function approved(Request $request): JsonResponse
    {
        return $this->collection($request, SenderIdResource::class, $this->senders->approved($this->tenant($request)->organizationId));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, SenderIdResource::class, $this->senders->find($this->tenant($request), $id));
    }

    /** POST multipart: value, type, purpose, sampleMessage, documents[] */
    public function store(SenderIdRequest $request): JsonResponse
    {
        $files = $request->file('documents', []);

        return $this->resource($request, SenderIdResource::class, $this->senders->request($this->tenant($request), $request->payload(), is_array($files) ? $files : [$files]), 201);
    }

    /** PUT /app/sender-ids/{id}: the only customer-editable property is the default flag. */
    public function update(Request $request, string $id): JsonResponse
    {
        $request->validate(['isDefault' => ['required', 'accepted']], ['isDefault.*' => 'Only setting the default sender is supported.']);
        $ctx = $this->tenant($request);
        $this->senders->setDefault($ctx, $id);

        return $this->resource($request, SenderIdResource::class, $this->senders->find($ctx, $id));
    }

    /** DELETE: withdraw a pending request (approved sender IDs are suspended by admins only). */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->senders->withdraw($this->tenant($request), $id);

        return $this->ok(['deleted' => true]);
    }

    public function document(Request $request, string $id, int $index): Response
    {
        $doc = $this->senders->document($this->tenant($request)->organizationId, $id, $index);

        return self::download($doc);
    }

    /** @param array{body: string, contentType: string, name: string} $doc */
    public static function download(array $doc): Response
    {
        return response($doc['body'], 200, [
            'Content-Type' => $doc['contentType'],
            'Content-Disposition' => 'attachment; filename="'.str_replace(['"', "\r", "\n"], '', $doc['name']).'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
