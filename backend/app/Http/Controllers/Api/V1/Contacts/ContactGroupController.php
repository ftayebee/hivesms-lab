<?php

namespace App\Http\Controllers\Api\V1\Contacts;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Contacts\GroupRequest;
use App\Http\Resources\ContactGroupResource;
use App\Http\Resources\ContactResource;
use App\Services\Contact\ContactService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Contact groups with member counts; assignment via the contact bulk endpoint or below. */
class ContactGroupController extends ApiController
{
    public function __construct(private readonly ContactService $contacts) {}

    public function index(Request $request): JsonResponse
    {
        return $this->ok($this->contacts->groups($this->tenant($request)));
    }

    public function store(GroupRequest $request): JsonResponse
    {
        return $this->resource($request, ContactGroupResource::class, $this->contacts->saveGroup($this->tenant($request), $request->payload()), 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, ContactGroupResource::class, $this->contacts->findGroup($this->tenant($request), $id));
    }

    public function update(GroupRequest $request, string $id): JsonResponse
    {
        return $this->resource($request, ContactGroupResource::class, $this->contacts->saveGroup($this->tenant($request), $request->payload(), $id));
    }

    /** Deletes the group; its contacts are kept. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->contacts->deleteGroup($this->tenant($request), $id);

        return $this->ok(['deleted' => true]);
    }

    /** GET /app/contact-groups/{id}/contacts: members of a group (paginated contact list). */
    public function contacts(Request $request, string $id): JsonResponse
    {
        $ctx = $this->tenant($request);
        $this->contacts->findGroup($ctx, $id);

        return $this->paginated($request, $this->contacts->list($ctx, ['group' => $id, 'q' => $request->query('q'), 'page' => $this->page($request)]), ContactResource::class);
    }

    /** POST /app/contact-groups/{id}/contacts {ids}: add contacts to the group. */
    public function attach(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['ids' => ['required', 'array', 'min:1', 'max:1000'], 'ids.*' => ['uuid']]);

        return $this->ok(['updated' => $this->contacts->bulk($this->tenant($request), $data['ids'], ['type' => 'addToGroup', 'groupId' => $id])]);
    }

    /** DELETE /app/contact-groups/{id}/contacts {ids}: remove contacts from the group. */
    public function detach(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['ids' => ['required', 'array', 'min:1', 'max:1000'], 'ids.*' => ['uuid']]);

        return $this->ok(['updated' => $this->contacts->bulk($this->tenant($request), $data['ids'], ['type' => 'removeFromGroup', 'groupId' => $id])]);
    }
}
