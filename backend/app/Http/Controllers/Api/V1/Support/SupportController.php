<?php

namespace App\Http\Controllers\Api\V1\Support;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Account\TicketRequest;
use App\Http\Resources\SupportMessageResource;
use App\Http\Resources\SupportTicketResource;
use App\Services\Support\SupportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Customer support tickets of the organization (internal staff notes are never returned). */
class SupportController extends ApiController
{
    public function __construct(private readonly SupportService $support) {}

    public function index(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:OPEN,IN_PROGRESS,WAITING_FOR_CUSTOMER,RESOLVED,CLOSED']]);

        return $this->paginated($request, $this->support->list($this->tenant($request), $q['status'] ?? null, $this->page($request)), SupportTicketResource::class, ['categories' => SupportService::CATEGORIES]);
    }

    public function store(TicketRequest $request): JsonResponse
    {
        $t = $this->support->create($this->tenant($request), $request->payload());

        return $this->resource($request, SupportTicketResource::class, $this->support->find($this->tenant($request), $t->id), 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, SupportTicketResource::class, $this->support->find($this->tenant($request), $id));
    }

    public function reply(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['body' => ['required', 'string', 'min:1', 'max:10000']], ['body.*' => 'Write a reply.']);

        return $this->resource($request, SupportMessageResource::class, $this->support->reply($this->tenant($request), $id, trim($data['body'])), 201);
    }

    public function close(Request $request, string $id): JsonResponse
    {
        $this->support->close($this->tenant($request), $id);

        return $this->ok(['message' => 'Ticket closed.']);
    }
}
