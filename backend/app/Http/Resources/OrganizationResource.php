<?php

namespace App\Http\Resources;

use App\Support\Money;

class OrganizationResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'name' => $this->f('name'),
            'slug' => $this->f('slug'),
            'status' => $this->f('status'),
            'suspendedReason' => $this->f('suspendedReason'),
            'industry' => $this->f('industry'),
            'website' => $this->f('website'),
            'address' => $this->f('address'),
            'billingEmail' => $this->f('billingEmail'),
            'taxId' => $this->f('taxId'),
            'country' => $this->f('country'),
            'timezone' => $this->f('timezone'),
            'pricingPlanId' => $this->f('pricingPlanId'),
            'dailySendLimit' => $this->f('dailySendLimit'),
            'monthlySendLimit' => $this->f('monthlySendLimit'),
            'requireCampaignReview' => $this->f('requireCampaignReview'),
            'createdAt' => $this->date('createdAt'),
            'pricingPlan' => $this->whenLoaded('pricingPlan', fn () => $this->pricingPlan ? ['id' => $this->pricingPlan->id, 'name' => $this->pricingPlan->name] : null),
            'balance' => $this->whenLoaded('wallet', fn () => Money::round($this->wallet ? (string) $this->wallet->balance : '0', 2)),
            'membersCount' => $this->when($this->loaded('members_count'), fn () => (int) $this->members_count),
            'messagesCount' => $this->when($this->loaded('messages_count'), fn () => (int) $this->messages_count),
        ];
    }
}
