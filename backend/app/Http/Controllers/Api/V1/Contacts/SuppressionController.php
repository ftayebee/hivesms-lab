<?php

namespace App\Http\Controllers\Api\V1\Contacts;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Contacts\SuppressionRequest;
use App\Http\Resources\SuppressionEntryResource;
use App\Services\Contact\ContactService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Organization suppression list (opt-outs and manual suppressions). */
class SuppressionController extends ApiController
{
    public function __construct(private readonly ContactService $contacts) {}

    public function index(Request $request): JsonResponse
    {
        $q = $request->validate(['q' => ['nullable', 'string', 'max:30']]);

        return $this->paginated($request, $this->contacts->suppressionList($this->tenant($request), $this->page($request), $q['q'] ?? null), SuppressionEntryResource::class);
    }

    public function store(SuppressionRequest $request): JsonResponse
    {
        return $this->resource($request, SuppressionEntryResource::class, $this->contacts->addSuppression($this->tenant($request), $request->payload()), 201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->contacts->removeSuppression($this->tenant($request), $id);

        return $this->ok(['deleted' => true]);
    }
}
