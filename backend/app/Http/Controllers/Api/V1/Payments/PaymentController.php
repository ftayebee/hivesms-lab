<?php

namespace App\Http\Controllers\Api\V1\Payments;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Billing\ManualReferenceRequest;
use App\Http\Requests\Billing\TopUpRequest;
use App\Http\Resources\PaymentResource;
use App\Services\Payment\PaymentProviderManager;
use App\Services\Platform\SettingsService;
use App\Services\Wallet\BillingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Wallet top-ups: preview (VAT/bonus), create a payment and start checkout (redirect URL or manual
 * instructions), submit a manual transfer reference, cancel. Credits are only added by
 * PaymentService::complete (gateway-verified callback or admin verification).
 */
class PaymentController extends ApiController
{
    public function __construct(private readonly BillingService $billing) {}

    /** GET /app/payments/methods: enabled providers, active packages and the top-up rules the wallet page shows. */
    public function methods(PaymentProviderManager $providers, SettingsService $settings): JsonResponse
    {
        $policy = $settings->billingPolicy();

        return $this->ok([
            'providers' => $providers->available(),
            'packages' => $this->billing->packages(),
            'policy' => [
                'vatRatePercent' => $policy['vatRatePercent'],
                'minimumTopUp' => $policy['minimumTopUp'],
                'maximumTopUp' => $policy['maximumTopUp'],
                'balanceValidityMonths' => $policy['balanceValidityMonths'],
            ],
        ]);
    }

    public function preview(TopUpRequest $request): JsonResponse
    {
        $b = $this->billing->preview($request->input('packageId'), $request->amount());

        return $this->ok($b);
    }

    public function index(Request $request): JsonResponse
    {
        return $this->paginated($request, $this->billing->payments($this->tenant($request), $this->page($request)), PaymentResource::class);
    }

    /** POST /app/payments {packageId|amount, provider} → payment + checkout {type: redirect|manual}. */
    public function store(TopUpRequest $request): JsonResponse
    {
        $user = $this->session($request)->user;
        $r = $this->billing->createTopUp($this->tenant($request), $request->input('packageId'), $request->amount(), $request->input('provider'), [
            'name' => $user->name, 'email' => $user->email, 'phone' => $user->phone,
        ]);

        return $this->ok(['payment' => (new PaymentResource($r['payment']->load('invoice:id,paymentId,number')))->resolve($request), 'checkout' => $r['checkout']], 201);
    }

    /** GET /app/payments/{id}; manual payments carry the admin-configured transfer instructions in meta. */
    public function show(Request $request, string $id, SettingsService $settings): JsonResponse
    {
        $payment = $this->billing->payment($this->tenant($request), $id);
        $meta = $payment->provider === 'manual' ? ['manualInstructions' => $settings->paymentSettings()['manualInstructions']] : [];

        return $this->resource($request, PaymentResource::class, $payment, 200, $meta);
    }

    public function submitReference(ManualReferenceRequest $request, string $id): JsonResponse
    {
        $ctx = $this->tenant($request);
        $this->billing->submitManualReference($ctx, $id, trim($request->input('reference')));

        return $this->resource($request, PaymentResource::class, $this->billing->payment($ctx, $id), 200, ['message' => "Reference submitted. We'll add the balance after verifying the payment."]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $ctx = $this->tenant($request);
        $this->billing->cancelPending($ctx, $id);

        return $this->resource($request, PaymentResource::class, $this->billing->payment($ctx, $id));
    }

    /** Development/staging only: complete a mock payment (success | fail | cancel). */
    public function mockComplete(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['outcome' => ['required', 'in:success,fail,cancel']]);

        return $this->resource($request, PaymentResource::class, $this->billing->mockComplete($this->tenant($request), $id, $data['outcome']));
    }
}
