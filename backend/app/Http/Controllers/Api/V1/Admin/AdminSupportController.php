<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Admin\StaffReplyRequest;
use App\Http\Resources\SupportTicketResource;
use App\Services\Admin\AdminService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Support desk: queue, ticket with internal notes, replies, status/assignment. */
class AdminSupportController extends ApiController
{
    public function __construct(private readonly AdminService $admin) {}

    public function index(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:OPEN,IN_PROGRESS,WAITING_FOR_CUSTOMER,RESOLVED,CLOSED'], 'mine' => ['nullable', 'boolean']]);
        $mine = $request->boolean('mine') ? $this->admin($request)->userId : null;

        return $this->paginated($request, $this->admin->tickets($q['status'] ?? null, $mine, $this->page($request)), SupportTicketResource::class);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, SupportTicketResource::class, $this->admin->ticket($id));
    }

    public function reply(StaffReplyRequest $request, string $id): JsonResponse
    {
        $internal = $request->boolean('internal');
        $this->admin->staffReply($this->admin($request), $id, trim($request->input('body')), $internal, $request->input('status'));

        return $this->ok(['message' => $internal ? 'Internal note added.' : 'Reply sent to the customer.'], 201);
    }

    public function status(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:OPEN,IN_PROGRESS,WAITING_FOR_CUSTOMER,RESOLVED,CLOSED'], 'assignToMe' => ['nullable', 'boolean']]);
        $this->admin->setTicketStatus($this->admin($request), $id, $data['status'], $request->boolean('assignToMe'));

        return $this->ok(['message' => 'Ticket updated.']);
    }
}
