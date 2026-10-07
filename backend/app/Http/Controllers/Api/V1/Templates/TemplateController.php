<?php

namespace App\Http\Controllers\Api\V1\Templates;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Messaging\TemplateRequest;
use App\Http\Resources\TemplateResource;
use App\Services\Template\TemplateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TemplateController extends ApiController
{
    public function __construct(private readonly TemplateService $templates) {}

    public function index(Request $request): JsonResponse
    {
        $q = $request->validate(['q' => ['nullable', 'string', 'max:100']]);

        return $this->collection($request, TemplateResource::class, $this->templates->list($this->tenant($request), $q['q'] ?? null));
    }

    public function store(TemplateRequest $request): JsonResponse
    {
        return $this->resource($request, TemplateResource::class, $this->templates->save($this->tenant($request), $request->payload()), 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, TemplateResource::class, $this->templates->find($this->tenant($request), $id));
    }

    public function update(TemplateRequest $request, string $id): JsonResponse
    {
        return $this->resource($request, TemplateResource::class, $this->templates->save($this->tenant($request), $request->payload(), $id));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->templates->delete($this->tenant($request), $id);

        return $this->ok(['deleted' => true]);
    }
}
