<?php

namespace App\Http\Resources;

class PricingPlanResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'key' => $this->f('key'),
            'name' => $this->f('name'),
            'description' => $this->f('description'),
            'minRechargeAmount' => $this->money('minRechargeAmount'),
            'transactionalNonMasking' => $this->money('transactionalNonMasking', 4),
            'transactionalMasking' => $this->money('transactionalMasking', 4),
            'promotionalNonMasking' => $this->money('promotionalNonMasking', 4),
            'promotionalMasking' => $this->money('promotionalMasking', 4),
            'senderIdFee' => $this->money('senderIdFee'),
            'features' => $this->f('features'),
            'isCustom' => $this->f('isCustom'),
            'isPublic' => $this->f('isPublic'),
            'isDefault' => $this->f('isDefault'),
            'active' => $this->f('active'),
            'highlighted' => $this->f('highlighted'),
            'sortOrder' => $this->f('sortOrder'),
        ];
    }
}
