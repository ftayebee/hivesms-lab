<?php

namespace App\Http\Resources;

use App\Support\Money;

class PaymentResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'provider' => $this->f('provider'),
            'providerRef' => $this->f('providerRef'),
            'packageId' => $this->f('packageId'),
            'amount' => $this->money('amount'),
            'vatRate' => $this->when($this->loaded('vatRate'), fn () => Money::plain((string) $this->vatRate)),
            'vatAmount' => $this->money('vatAmount'),
            'total' => $this->money('total'),
            'creditAmount' => $this->money('creditAmount'),
            'currency' => $this->f('currency'),
            'status' => $this->f('status'),
            'method' => $this->f('method'),
            'manualReference' => $this->f('manualReference'),
            'label' => $this->when($this->loaded('metadata'), fn () => ((array) $this->metadata)['label'] ?? null),
            'failureReason' => $this->f('failureReason'),
            'completedAt' => $this->date('completedAt'),
            'createdAt' => $this->date('createdAt'),
            'invoice' => $this->whenLoaded('invoice', fn () => $this->invoice ? ['id' => $this->invoice->id, 'number' => $this->invoice->number] : null),
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? ['id' => $this->organization->id, 'name' => $this->organization->name] : null),
        ];
    }
}
