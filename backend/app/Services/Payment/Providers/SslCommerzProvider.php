<?php

namespace App\Services\Payment\Providers;

use App\Services\Payment\PaymentProviderInterface;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * SSLCommerz hosted checkout (port of the Node adapter).
 *
 * ⚠ UNVERIFIED, as in the Node app: written from SSLCommerz's public v4 session + validation API
 * docs but not run against a sandbox account. Before enabling: set sandbox credentials (Admin →
 * Settings → Payments), run a payment, a failure and a cancellation, and confirm the IPN reaches
 * /api/v1/webhooks/payments/sslcommerz from the internet.
 *
 * Never trusts the browser redirect or the IPN body: success is only reported after the
 * validation API confirms status, transaction id and currency (the amount is compared by the
 * payment service).
 */
class SslCommerzProvider implements PaymentProviderInterface
{
    public function __construct(private readonly string $storeId, private readonly string $storePassword, private readonly bool $live) {}

    private function base(): string
    {
        return $this->live ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
    }

    public function key(): string
    {
        return 'sslcommerz';
    }

    public function displayName(): string
    {
        return 'SSLCommerz (cards, mobile banking)';
    }

    public function description(): string
    {
        return 'Hosted checkout by SSLCommerz. Requires merchant credentials.';
    }

    public function verified(): bool
    {
        return false;
    }

    public function createCheckout(array $req): array
    {
        if ($this->storeId === '' || $this->storePassword === '') {
            throw new RuntimeException('SSLCommerz credentials are not configured.');
        }
        $res = Http::asForm()->timeout(20)->post($this->base().'/gwprocess/v4/api.php', [
            'store_id' => $this->storeId, 'store_passwd' => $this->storePassword, 'total_amount' => $req['total'], 'currency' => $req['currency'],
            'tran_id' => $req['paymentId'], 'success_url' => $req['successUrl'], 'fail_url' => $req['failUrl'], 'cancel_url' => $req['cancelUrl'],
            'ipn_url' => $req['callbackUrl'], 'cus_name' => $req['customer']['name'], 'cus_email' => $req['customer']['email'],
            'cus_phone' => $req['customer']['phone'] ?? 'N/A', 'cus_add1' => 'N/A', 'cus_city' => 'Dhaka', 'cus_country' => 'Bangladesh',
            'shipping_method' => 'NO', 'product_name' => $req['description'], 'product_category' => 'SMS credit', 'product_profile' => 'non-physical-goods',
        ]);
        $body = (array) $res->json();
        if (($body['status'] ?? null) !== 'SUCCESS' || empty($body['GatewayPageURL'])) {
            Log::error('sslcommerz session failed', ['provider' => $this->key(), 'status' => $body['status'] ?? null, 'reason' => $body['failedreason'] ?? null]);
            throw new RuntimeException((string) ($body['failedreason'] ?? 'Could not start the payment session.'));
        }

        return ['type' => 'redirect', 'url' => (string) $body['GatewayPageURL'], 'providerRef' => $body['sessionkey'] ?? null];
    }

    public function handleCallback(array $query, array $form): ?array
    {
        $tranId = (string) ($form['tran_id'] ?? $query['tran_id'] ?? '');
        $valId = (string) ($form['val_id'] ?? '');
        $status = strtoupper((string) ($form['status'] ?? ''));
        if ($tranId === '') {
            throw new RuntimeException('Missing tran_id');
        }
        if ($status === 'CANCELLED') {
            return ['paymentId' => $tranId, 'outcome' => 'cancelled', 'reason' => 'Cancelled by customer'];
        }
        if ($valId === '' || ! in_array($status, ['VALID', 'VALIDATED'], true)) {
            return ['paymentId' => $tranId, 'outcome' => 'failed', 'reason' => (string) ($form['error'] ?? 'Gateway status '.($status ?: 'unknown'))];
        }
        $v = (array) Http::timeout(20)->get($this->base().'/validator/api/validationserverAPI.php', [
            'val_id' => $valId, 'store_id' => $this->storeId, 'store_passwd' => $this->storePassword, 'v' => '1', 'format' => 'json',
        ])->json();
        // Amount must be present: PaymentService compares it with the expected total before crediting.
        $ok = in_array($v['status'] ?? null, ['VALID', 'VALIDATED'], true) && ($v['tran_id'] ?? null) === $tranId && ($v['currency'] ?? null) === 'BDT'
            && isset($v['amount']) && is_numeric($v['amount']);

        return [
            'paymentId' => $tranId,
            'outcome' => $ok ? 'succeeded' : 'failed',
            'providerRef' => (string) ($v['bank_tran_id'] ?? $valId),
            'confirmedAmount' => isset($v['amount']) ? (string) $v['amount'] : null,
            'reason' => $ok ? null : 'Validation returned '.($v['status'] ?? 'no status'),
            'raw' => ['status' => $v['status'] ?? null, 'tran_id' => $v['tran_id'] ?? null, 'amount' => $v['amount'] ?? null],
        ];
    }
}
