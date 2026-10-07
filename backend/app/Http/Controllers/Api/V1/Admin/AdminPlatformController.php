<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Resources\ApiLogResource;
use App\Http\Resources\AuditLogResource;
use App\Http\Resources\MessageResource;
use App\Http\Resources\UserResource;
use App\Models\AbuseReport;
use App\Models\Campaign;
use App\Models\ContactRequest;
use App\Models\Organization;
use App\Models\Payment;
use App\Models\SenderId;
use App\Models\SupportTicket;
use App\Services\Admin\AdminService;
use App\Support\Dhaka;
use App\Support\Phone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Platform overview, users, abuse reports, leads and logs. */
class AdminPlatformController extends ApiController
{
    public function __construct(private readonly AdminService $admin) {}

    /** GET /admin/overview: full overview (camelCase) including the 30-day series. */
    public function overview(): JsonResponse
    {
        return $this->ok($this->admin->overview());
    }

    /** GET /admin/stats — existing snake_case contract. */
    public function stats(): JsonResponse
    {
        $o = $this->admin->overview();

        return $this->ok([
            'users' => $o['users'], 'active_users_30d' => $o['activeUsers'], 'organizations' => $o['orgs'], 'suspended_organizations' => $o['suspendedOrgs'],
            'sms_today' => $o['smsToday'], 'sms_30d' => $o['sms30'], 'failed_messages_24h' => $o['failed24'], 'revenue_30d' => $o['revenue30'],
            'pending_sender_ids' => $o['pendingSenders'], 'pending_payments' => $o['pendingPayments'], 'campaigns_in_review' => $o['reviewCampaigns'],
            'open_tickets' => $o['openTickets'], 'api_requests_24h' => $o['api24'],
        ]);
    }

    /** GET /admin/badges: the five work-queue counters of the admin navigation (port of app/admin/layout.tsx). */
    public function badges(): JsonResponse
    {
        return $this->ok([
            'campaignsInReview' => Campaign::query()->where('status', 'PENDING_REVIEW')->count(),
            'pendingSenderIds' => SenderId::query()->where('status', 'PENDING')->count(),
            'paymentsAwaitingVerification' => Payment::query()->where('status', 'AWAITING_VERIFICATION')->count(),
            'openTickets' => SupportTicket::query()->where('status', 'OPEN')->count(),
            'newAbuseReports' => AbuseReport::query()->where('status', 'NEW')->count(),
        ]);
    }

    public function users(Request $request): JsonResponse
    {
        $q = $request->validate(['q' => ['nullable', 'string', 'max:100'], 'role' => ['nullable', 'in:USER,SUPPORT,ADMIN,SUPER_ADMIN']]);

        return $this->paginated($request, $this->admin->users($q['q'] ?? null, $q['role'] ?? null, $this->page($request)), UserResource::class);
    }

    /** PUT /admin/users/{id}/access {platformRole?, status?}: sessions of the user are revoked. */
    public function updateUserAccess(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['platformRole' => ['nullable', 'in:USER,SUPPORT,ADMIN,SUPER_ADMIN'], 'status' => ['nullable', 'in:ACTIVE,SUSPENDED']]);
        $u = $this->admin->updateUserAccess($this->admin($request), $id, ['platformRole' => $data['platformRole'] ?? null, 'status' => $data['status'] ?? null]);

        return $this->resource($request, UserResource::class, $u, 200, ['message' => 'User updated. Their sessions were signed out.']);
    }

    public function abuseReports(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:NEW,INVESTIGATING,ACTIONED,DISMISSED']]);
        $page = $this->admin->abuseReports($q['status'] ?? null, $this->page($request));
        // abuse_reports has no relation to organizations (the sender may be unknown): one lookup for the page.
        $orgNames = Organization::withTrashed()->whereIn('id', $page->getCollection()->pluck('organizationId')->filter()->unique())->pluck('name', 'id');

        return $this->ok($page->getCollection()->map(fn (AbuseReport $r) => [
            'id' => $r->id, 'reporterName' => $r->reporterName, 'reporterEmail' => $r->reporterEmail, 'reporterPhone' => $r->reporterPhone,
            'senderValue' => $r->senderValue, 'messageContent' => $r->messageContent, 'receivedAt' => Dhaka::iso($r->receivedAt),
            'description' => $r->description, 'status' => $r->status->value, 'organizationId' => $r->organizationId,
            'organizationName' => $r->organizationId ? ($orgNames[$r->organizationId] ?? null) : null,
            'resolutionNote' => $r->resolutionNote, 'createdAt' => Dhaka::iso($r->createdAt),
        ])->values(), 200, ['page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'total' => $page->total(), 'totalPages' => $page->lastPage()]);
    }

    public function updateAbuse(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:NEW,INVESTIGATING,ACTIONED,DISMISSED'], 'note' => ['nullable', 'string', 'max:500']]);
        $this->admin->setAbuseStatus($this->admin($request), $id, $data['status'], isset($data['note']) ? trim($data['note']) ?: null : null);

        return $this->ok(['message' => 'Report updated.']);
    }

    public function leads(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:NEW,CONTACTED,CLOSED']]);
        $page = $this->admin->leads($q['status'] ?? null, $this->page($request));

        return $this->ok($page->getCollection()->map(fn (ContactRequest $r) => [
            'id' => $r->id, 'name' => $r->name, 'company' => $r->company, 'email' => $r->email, 'phone' => $r->phone,
            'subject' => $r->subject, 'message' => $r->message, 'status' => $r->status->value, 'createdAt' => Dhaka::iso($r->createdAt),
        ])->values(), 200, ['page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'total' => $page->total(), 'totalPages' => $page->lastPage()]);
    }

    public function updateLead(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:NEW,CONTACTED,CLOSED']]);
        $this->admin->setLeadStatus($this->admin($request), $id, $data['status']);

        return $this->ok(['message' => 'Lead updated.']);
    }

    public function messages(Request $request): JsonResponse
    {
        $q = $request->validate([
            'organizationId' => ['nullable', 'uuid'], 'campaignId' => ['nullable', 'uuid'], 'to' => ['nullable', 'string', 'max:30'],
            'status' => ['nullable', 'in:QUEUED,SUBMITTED,DELIVERED,FAILED,REJECTED,EXPIRED,CANCELLED'],
        ]);
        if (! empty($q['to'])) {
            $q['to'] = Phone::normalize($q['to']) ?? $q['to'];
        }

        return $this->paginated($request, $this->admin->messages($q, $this->page($request)), MessageResource::class);
    }

    public function auditLogs(Request $request): JsonResponse
    {
        $q = $request->validate(['organizationId' => ['nullable', 'uuid'], 'action' => ['nullable', 'string', 'max:100']]);

        return $this->paginated($request, $this->admin->auditLogs($q, $this->page($request)), AuditLogResource::class);
    }

    public function apiLogs(Request $request): JsonResponse
    {
        $q = $request->validate(['organizationId' => ['nullable', 'uuid'], 'status' => ['nullable', 'in:4xx,5xx']]);

        return $this->paginated($request, $this->admin->apiLogs($q, $this->page($request)), ApiLogResource::class);
    }
}
