<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Controllers\Api\V1\SenderIds\SenderIdController;
use App\Services\Payment\ManualTopUpService;
use App\Services\Payment\PaymentMethodService;
use App\Services\Platform\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Super Admin: payment receiving methods (admin:settings:manage) and the manual payment request
 * queue (admin:topups:review to look, admin:topups:approve to credit/reject). Docs/22.
 */
class AdminManualPaymentController extends ApiController
{
    public function __construct(private readonly PaymentMethodService $methods, private readonly ManualTopUpService $topups) {}

    // ─── Payment methods ───

    public function methods(): JsonResponse
    {
        return $this->ok($this->methods->all()->map(fn ($m) => PaymentMethodService::adminShape($m))->values());
    }

    /** @return array<string, mixed> */
    private function methodInput(Request $request): array
    {
        return $request->validate([
            'type' => ['required', 'in:BKASH,NAGAD,ROCKET,BANK,OTHER'],
            'displayName' => ['required', 'string', 'min:2', 'max:120'],
            'accountNumber' => ['required', 'string', 'min:4', 'max:64', 'regex:/^[A-Za-z0-9 \-\/]+$/'],
            'accountName' => ['nullable', 'string', 'max:120'],
            'accountType' => ['nullable', 'in:personal,merchant,agent,current,savings,other'],
            'bankName' => ['nullable', 'string', 'max:120'],
            'branchName' => ['nullable', 'string', 'max:120'],
            'routingNumber' => ['nullable', 'string', 'max:40', 'regex:/^[0-9 \-]*$/'],
            'instructions' => ['nullable', 'string', 'max:2000'],
            'minAmount' => ['nullable', 'numeric', 'min:1', 'max:100000000'],
            'maxAmount' => ['nullable', 'numeric', 'min:1', 'max:100000000'],
            'requireProof' => ['nullable', 'boolean'],
            'requireSenderNumber' => ['nullable', 'boolean'],
            'active' => ['nullable', 'boolean'],
            'sortOrder' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'currentPassword' => ['nullable', 'string', 'max:200'],
        ]);
    }

    public function storeMethod(Request $request): JsonResponse
    {
        $in = $this->methodInput($request);
        $m = $this->methods->save($this->admin($request), $in, null, $in['currentPassword'] ?? null);

        return $this->ok(PaymentMethodService::adminShape($m), 201, ['message' => 'Payment method added.']);
    }

    public function updateMethod(Request $request, string $id): JsonResponse
    {
        $in = $this->methodInput($request);
        $m = $this->methods->save($this->admin($request), $in, $id, $in['currentPassword'] ?? null);

        return $this->ok(PaymentMethodService::adminShape($m), 200, ['message' => 'Payment method saved.']);
    }

    public function destroyMethod(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['currentPassword' => ['nullable', 'string', 'max:200']]);
        $this->methods->delete($this->admin($request), $id, $data['currentPassword'] ?? null);

        return $this->ok(['deleted' => true]);
    }

    public function reorder(Request $request): JsonResponse
    {
        $data = $request->validate(['ids' => ['required', 'array', 'max:100'], 'ids.*' => ['uuid']]);
        $this->methods->reorder($this->admin($request), $data['ids']);

        return $this->ok(['reordered' => true]);
    }

    public function uploadQr(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['file' => ['required', 'file'], 'currentPassword' => ['nullable', 'string', 'max:200']]);
        $m = $this->methods->uploadQr($this->admin($request), $id, $request->file('file'), $data['currentPassword'] ?? null);

        return $this->ok(PaymentMethodService::adminShape($m));
    }

    public function qr(string $id): Response
    {
        $doc = $this->methods->qr($id, false);

        return response($doc['body'], 200, ['Content-Type' => $doc['contentType'], 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    // ─── Requests ───

    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'status' => ['nullable', 'in:pending,under_review,approved,rejected,cancelled'],
            'from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d'],
            'methodId' => ['nullable', 'uuid'], 'organizationId' => ['nullable', 'uuid'], 'q' => ['nullable', 'string', 'max:100'],
        ]);
        $page = $this->topups->adminList($f, $this->page($request));

        return $this->ok($page->getCollection()->map(fn ($p) => ManualTopUpService::adminShape($p))->values(), 200, [
            'page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'total' => $page->total(),
        ]);
    }

    public function show(string $id): JsonResponse
    {
        return $this->ok(ManualTopUpService::adminShape($this->topups->adminFind($id)));
    }

    /** Staff view of a customer's proof (any tenant), audited. */
    public function proof(Request $request, string $id, AuditLogger $audit): Response
    {
        $p = $this->topups->adminFind($id);
        $doc = $this->topups->proof($p);
        $audit->log('admin.topup_request.proof_view', $this->admin($request)->actor(), $p->organizationId, 'payment', $id, ip: $request->ip());

        return SenderIdController::download($doc);
    }

    public function underReview(Request $request, string $id): JsonResponse
    {
        return $this->ok(ManualTopUpService::adminShape($this->topups->markUnderReview($this->admin($request), $id)));
    }

    public function note(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['note' => ['required', 'string', 'max:1000']]);

        return $this->ok(ManualTopUpService::adminShape($this->topups->addNote($this->admin($request), $id, $data['note'])));
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'receivedAmount' => ['required', 'numeric', 'min:0'], 'reference' => ['required', 'string', 'max:40'],
            'note' => ['nullable', 'string', 'max:500'], 'currentPassword' => ['nullable', 'string', 'max:200'],
        ]);
        $p = $this->topups->approve($this->admin($request), $id, (string) $data['receivedAmount'], $data['reference'], $data['note'] ?? null, $data['currentPassword'] ?? null);

        return $this->ok(ManualTopUpService::adminShape($p), 200, ['message' => 'Approved. The wallet was credited.']);
    }

    public function reject(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500'], 'currentPassword' => ['nullable', 'string', 'max:200']], ['reason.required' => 'Give the customer a reason.']);
        $p = $this->topups->reject($this->admin($request), $id, $data['reason'], $data['currentPassword'] ?? null);

        return $this->ok(ManualTopUpService::adminShape($p), 200, ['message' => 'Rejected. Nothing was credited.']);
    }
}
