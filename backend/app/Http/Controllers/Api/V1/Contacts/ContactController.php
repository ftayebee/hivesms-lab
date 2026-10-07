<?php

namespace App\Http\Controllers\Api\V1\Contacts;

use App\Exceptions\AppException;
use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Contacts\BulkContactsRequest;
use App\Http\Requests\Contacts\ContactRequest;
use App\Http\Resources\ContactResource;
use App\Services\Contact\ContactService;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Contacts CRUD, search/filter/sort, bulk actions, tags (all tenant-scoped). */
class ContactController extends ApiController
{
    public function __construct(private readonly ContactService $contacts) {}

    /** GET /app/contacts?q=&group=&tag=&consent=&sort=newest|oldest|name&page= */
    public function index(Request $request): JsonResponse
    {
        $q = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'group' => ['nullable', 'uuid'],
            'tag' => ['nullable', 'string', 'max:40'],
            'consent' => ['nullable', 'in:OPTED_IN,UNKNOWN,OPTED_OUT'],
            'sort' => ['nullable', 'in:newest,oldest,name'],
        ]);

        return $this->paginated($request, $this->contacts->list($this->tenant($request), $q + ['page' => $this->page($request)]), ContactResource::class);
    }

    public function store(ContactRequest $request): JsonResponse
    {
        return $this->resource($request, ContactResource::class, $this->contacts->create($this->tenant($request), $request->payload()), 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, ContactResource::class, $this->contacts->find($this->tenant($request), $id));
    }

    public function update(ContactRequest $request, string $id): JsonResponse
    {
        return $this->resource($request, ContactResource::class, $this->contacts->update($this->tenant($request), $id, $request->payload()));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        // Scoped to the organization: an id from elsewhere (or already deleted) matches nothing.
        if ($this->contacts->bulk($this->tenant($request), [$id], ['type' => 'delete']) === 0) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Contact not found.');
        }

        return $this->ok(['deleted' => true]);
    }

    /** POST /app/contacts/bulk {ids: [...], action: {type, groupId?|tag?|consent?}} */
    public function bulk(BulkContactsRequest $request): JsonResponse
    {
        $n = $this->contacts->bulk($this->tenant($request), $request->input('ids'), $request->input('action'));

        return $this->ok(['updated' => $n]);
    }

    public function tags(Request $request): JsonResponse
    {
        return $this->ok($this->contacts->tags($this->tenant($request)));
    }
}
