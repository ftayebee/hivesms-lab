<?php

namespace App\Http\Resources;

use App\Http\RequestContext;
use App\Support\Money;

/** Documents are listed without their storage keys; downloads go through the documents endpoint. */
class SenderIdResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'value' => $this->f('value'),
            'type' => $this->f('type'),
            'status' => $this->f('status'),
            'purpose' => $this->f('purpose'),
            'sampleMessage' => $this->f('sampleMessage'),
            'documents' => $this->when($this->loaded('documents'), fn () => array_map(
                fn ($i, $d) => ['index' => $i, 'name' => $d['name'] ?? 'document', 'size' => $d['size'] ?? null, 'contentType' => $d['contentType'] ?? null],
                array_keys(array_values((array) $this->documents)),
                array_values((array) $this->documents),
            )),
            'rejectionReason' => $this->f('rejectionReason'),
            'providerRef' => $this->when((bool) $request->attributes->get(RequestContext::ADMIN), fn () => $this->f('providerRef')),
            'isDefault' => $this->f('isDefault'),
            'reviewedAt' => $this->date('reviewedAt'),
            'approvedAt' => $this->date('approvedAt'),
            'createdAt' => $this->date('createdAt'),
            'updatedAt' => $this->date('updatedAt'),
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? array_filter([
                'id' => $this->organization->id,
                'name' => $this->organization->name,
                'senderIdFee' => $this->organization->relationLoaded('pricingPlan') && $this->organization->pricingPlan ? Money::round((string) $this->organization->pricingPlan->senderIdFee, 2) : null,
            ], fn ($v) => $v !== null) : null),
        ];
    }
}
