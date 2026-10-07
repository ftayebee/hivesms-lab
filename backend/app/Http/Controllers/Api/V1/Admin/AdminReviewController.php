<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Controllers\Api\V1\SenderIds\SenderIdController;
use App\Http\Resources\CampaignResource;
use App\Http\Resources\PaymentResource;
use App\Http\Resources\SenderIdResource;
use App\Services\Admin\AdminService;
use App\Services\Platform\AuditLogger;
use App\Services\SenderId\SenderIdService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Review queues: campaigns, sender IDs (+ documents), manual payments. */
class AdminReviewController extends ApiController
{
    public function __construct(private readonly AdminService $admin) {}

    private function reason(Request $request): ?string
    {
        $r = $request->input('reason');

        return is_string($r) && trim($r) !== '' ? trim($r) : null;
    }

    public function campaigns(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:DRAFT,PENDING_REVIEW,SCHEDULED,PROCESSING,COMPLETED,PAUSED,CANCELLED,FAILED']]);

        return $this->paginated($request, $this->admin->campaigns($q['status'] ?? null, $this->page($request)), CampaignResource::class);
    }

    /** POST /admin/campaigns/{id}/review {decision: approve|reject, reason} */
    public function reviewCampaign(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', 'in:approve,reject'], 'reason' => ['nullable', 'string', 'max:500']]);
        $c = $this->admin->reviewCampaign($this->admin($request), $id, $data['decision'], $this->reason($request));

        return $this->resource($request, CampaignResource::class, $c, 200, ['message' => $data['decision'] === 'approve' ? 'Campaign approved.' : 'Campaign rejected.']);
    }

    public function senderIds(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:PENDING,APPROVED,REJECTED,SUSPENDED']]);

        return $this->paginated($request, $this->admin->senderIds($q['status'] ?? null, $this->page($request)), SenderIdResource::class);
    }

    /** POST /admin/sender-ids/{id}/review {decision: APPROVED|REJECTED|SUSPENDED, reason, provider_ref} — existing contract. */
    public function reviewSenderId(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', 'in:APPROVED,REJECTED,SUSPENDED'], 'reason' => ['nullable', 'string', 'max:500'], 'provider_ref' => ['nullable', 'string', 'max:100']]);
        $this->admin->reviewSenderId($this->admin($request), $id, $data['decision'], $this->reason($request), isset($data['provider_ref']) ? trim($data['provider_ref']) ?: null : null);

        return $this->ok(['id' => $id, 'status' => $data['decision']]);
    }

    /** Staff download of a sender ID document (any tenant), audited. */
    public function senderIdDocument(Request $request, string $id, int $index, SenderIdService $senders, AuditLogger $audit): Response
    {
        $doc = $senders->document(null, $id, $index);
        $audit->log('admin.sender_id.document_view', $this->admin($request)->actor(), null, 'sender_id', $id, ip: $request->ip());

        return SenderIdController::download($doc);
    }

    public function payments(Request $request): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:PENDING,AWAITING_VERIFICATION,SUCCEEDED,FAILED,CANCELLED,REFUNDED']]);

        return $this->paginated($request, $this->admin->payments($q['status'] ?? null, $this->page($request)), PaymentResource::class);
    }

    /** POST /admin/payments/{id}/review {decision: approve|reject, reason} — existing contract; approve credits the wallet once. */
    public function reviewPayment(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', 'in:approve,reject'], 'reason' => ['nullable', 'string', 'max:500']]);
        $this->admin->reviewManualPayment($this->admin($request), $id, $data['decision'], $this->reason($request));

        return $this->ok(['id' => $id, 'decision' => $data['decision']]);
    }
}
