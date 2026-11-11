<?php

namespace App\Http\Controllers\Api\V1\Payments;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Controllers\Api\V1\SenderIds\SenderIdController;
use App\Services\Payment\ManualTopUpService;
use App\Services\Payment\PaymentMethodService;
use App\Services\Platform\SettingsService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Customer side of manual top-ups (docs/22), behind `feature:manual_topups`: active receiving
 * methods, QR images, submitting a request with optional proof, request history, cancel.
 * Nothing here credits a wallet.
 */
class ManualTopUpController extends ApiController
{
    public function __construct(private readonly ManualTopUpService $topups, private readonly PaymentMethodService $methods) {}

    /** GET /app/payment-methods: active methods (receiving details only) + limits. */
    public function methods(Request $request, SettingsService $settings): JsonResponse
    {
        $this->tenant($request)->requirePermission('billing:read');
        $billing = $settings->billingPolicy();

        return $this->ok([
            'methods' => $this->methods->active()->map(fn ($m) => PaymentMethodService::publicShape($m))->values(),
            'policy' => [
                'vatRatePercent' => $billing['vatRatePercent'], 'minimumTopUp' => $billing['minimumTopUp'], 'maximumTopUp' => $billing['maximumTopUp'],
                'proofMaxBytes' => $settings->manualPaymentPolicy()['proofMaxBytes'],
            ],
        ]);
    }

    /** GET /app/payment-methods/{id}/qr: QR image of an ACTIVE method (served privately). */
    public function qr(Request $request, string $id): Response
    {
        $this->tenant($request)->requirePermission('billing:read');
        $doc = $this->methods->qr($id, true);

        return response($doc['body'], 200, [
            'Content-Type' => $doc['contentType'], 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, max-age=300',
            'Content-Disposition' => 'inline; filename="'.str_replace(['"', "\r", "\n"], '', $doc['name']).'"',
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $page = $this->topups->list($this->tenant($request), $this->page($request));

        return $this->ok($page->getCollection()->map(fn ($p) => ManualTopUpService::customerShape($p))->values(), 200, [
            'page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'total' => $page->total(),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->ok(ManualTopUpService::customerShape($this->topups->owned($this->tenant($request), $id)));
    }

    /** POST /app/topup-requests (multipart): method, amount, transactionId, senderNumber, paidAt, proof, note. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'paymentMethodId' => ['required', 'uuid'],
            'amount' => ['required', 'numeric', 'min:1', 'max:100000000'],
            'transactionId' => ['required', 'string', 'min:4', 'max:40', 'regex:/^[A-Za-z0-9\-_.\/]+$/'],
            'senderNumber' => ['nullable', 'string', 'max:40'],
            'paidAt' => ['required', 'string', 'max:40'],
            'note' => ['nullable', 'string', 'max:500'],
            'proof' => ['nullable', 'file'],
        ], [
            'transactionId.required' => 'Enter the transaction ID from your payment receipt.',
            'transactionId.regex' => 'Transaction IDs contain letters, digits and - _ . / only.',
            'paidAt.required' => 'Enter when you paid.',
        ]);
        $p = $this->topups->submit($this->tenant($request), $data, $request->file('proof'));

        return $this->ok(ManualTopUpService::customerShape($p), 201, ['message' => "Request submitted. We'll add ".Money::formatBdt((string) $p->creditAmount).' after verifying the payment.']);
    }

    public function proof(Request $request, string $id): Response
    {
        return SenderIdController::download($this->topups->proof($this->topups->owned($this->tenant($request), $id)));
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        return $this->ok(ManualTopUpService::customerShape($this->topups->cancel($this->tenant($request), $id)), 200, ['message' => 'Request cancelled.']);
    }
}
