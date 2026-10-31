<?php

namespace App\Http\Controllers\Api\V1\Webhooks;

use App\Http\Controllers\Controller;
use App\Services\Payment\PaymentCallbackService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Payment gateway callbacks. Both entry points only report success after the adapter re-validated
 * the transaction with the gateway; completion is idempotent (a duplicated IPN never credits twice).
 */
class PaymentWebhookController extends Controller
{
    public function __construct(private readonly PaymentCallbackService $callbacks) {}

    /** POST /api/v1/webhooks/payments/{provider}: server-to-server IPN. */
    public function ipn(Request $request, string $provider): JsonResponse
    {
        try {
            $r = $this->callbacks->process($provider, $request->query->all(), $request->request->all());

            return response()->json(['received' => true, 'outcome' => $r['outcome']]);
        } catch (Throwable $e) {
            Log::error('payment IPN failed', ['provider' => $provider, 'error' => $e->getMessage()]);

            return response()->json(['received' => false], 500);
        }
    }

    /** GET|POST /api/v1/payments/{provider}/return: browser return → redirect to the payment page. */
    public function return(Request $request, string $provider): RedirectResponse
    {
        $base = config('smsflow.frontend_url');
        try {
            $form = $request->isMethod('post') ? $request->request->all() : [];
            $r = $this->callbacks->process($provider, $request->query->all(), $form);
            if ($r['paymentId']) {
                return redirect()->away("{$base}/dashboard/wallet/payments/{$r['paymentId']}".($r['outcome'] === 'succeeded' ? '' : '?result=not_completed'), 303);
            }
        } catch (Throwable $e) {
            Log::error('payment return handling failed', ['provider' => $provider, 'error' => $e->getMessage()]);
        }

        return redirect()->away("{$base}/dashboard/wallet?payment=unknown", 303);
    }
}
