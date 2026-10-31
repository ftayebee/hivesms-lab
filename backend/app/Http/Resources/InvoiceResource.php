<?php

namespace App\Http\Resources;

use App\Support\Dhaka;
use App\Support\Money;

class InvoiceResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'paymentId' => $this->f('paymentId'),
            'number' => $this->f('number'),
            'subtotal' => $this->money('subtotal'),
            'vatRate' => $this->when($this->loaded('vatRate'), fn () => Money::plain((string) $this->vatRate)),
            'vatAmount' => $this->money('vatAmount'),
            'total' => $this->money('total'),
            'currency' => $this->f('currency'),
            'status' => $this->f('status'),
            'billingName' => $this->f('billingName'),
            'billingEmail' => $this->f('billingEmail'),
            'billingAddress' => $this->f('billingAddress'),
            'taxId' => $this->f('taxId'),
            'lineItems' => $this->f('lineItems'),
            'issuedAt' => $this->date('issuedAt'),
            'payment' => $this->whenLoaded('payment', fn () => $this->payment ? [
                'method' => $this->payment->method, 'providerRef' => $this->payment->providerRef, 'manualReference' => $this->payment->manualReference,
                'completedAt' => Dhaka::iso($this->payment->completedAt), 'creditAmount' => Money::round((string) $this->payment->creditAmount, 2),
            ] : null),
        ];
    }
}
