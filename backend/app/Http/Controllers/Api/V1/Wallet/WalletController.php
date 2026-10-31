<?php

namespace App\Http\Controllers\Api\V1\Wallet;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\TransactionResource;
use App\Services\Wallet\BillingService;
use App\Support\DateRange;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Wallet summary, ledger (transactions), invoices, low-balance threshold. */
class WalletController extends ApiController
{
    public function __construct(private readonly BillingService $billing) {}

    /** GET /app/wallet: balance, threshold, plan, SMS credits the balance covers, packages. */
    public function show(Request $request): JsonResponse
    {
        $ctx = $this->tenant($request);

        return $this->ok($this->billing->summary($ctx) + ['packages' => $this->billing->packages()]);
    }

    private function txFilters(Request $request): array
    {
        return $request->validate([
            'range' => ['nullable', 'in:today,7d,30d,90d,custom'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'type' => ['nullable', 'in:CREDIT,DEBIT'],
            'reason' => ['nullable', 'in:TOPUP,BONUS,SMS_CHARGE,REFUND,ADJUSTMENT,SENDER_ID_FEE'],
            'reference' => ['nullable', 'string', 'max:255'],
            'campaignId' => ['nullable', 'uuid'],
        ]);
    }

    /** GET /app/wallet/transactions?range=&type=&reason=&reference=&campaignId=&page= (sums in meta). */
    public function transactions(Request $request): JsonResponse
    {
        $f = $this->txFilters($request);
        $range = DateRange::fromQuery($request->query(), '90d');
        $r = $this->billing->transactions($this->tenant($request), $range, $f, $this->page($request));

        return $this->paginated($request, $r['page'], TransactionResource::class, ['range' => $range->toArray(), 'credit' => $r['credit'], 'debit' => $r['debit']]);
    }

    public function transaction(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, TransactionResource::class, $this->billing->transaction($this->tenant($request), $id));
    }

    public function exportTransactions(Request $request): StreamedResponse
    {
        $ctx = $this->tenant($request);
        $ctx->requirePermission('billing:read');
        $f = $this->txFilters($request);
        $range = DateRange::fromQuery($request->query(), '90d');

        return $this->csv('wallet-transactions', fn (callable $write) => $this->billing->exportTransactions($ctx, $range, $f, $write));
    }

    public function invoices(Request $request): JsonResponse
    {
        return $this->collection($request, InvoiceResource::class, $this->billing->invoices($this->tenant($request)));
    }

    public function invoice(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, InvoiceResource::class, $this->billing->invoice($this->tenant($request), $id));
    }

    public function threshold(Request $request): JsonResponse
    {
        $data = $request->validate(['threshold' => ['required', 'numeric', 'min:0', 'max:1000000']], ['threshold.*' => 'Must be zero or more.']);
        $this->billing->updateLowBalanceThreshold($this->tenant($request), (string) $data['threshold']);

        return $this->ok(['lowBalanceThreshold' => Money::round((string) $data['threshold'], 2)]);
    }
}
