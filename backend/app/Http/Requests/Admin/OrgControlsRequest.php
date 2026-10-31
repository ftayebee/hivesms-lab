<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

class OrgControlsRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'dailySendLimit' => ['required', 'integer', 'min:0', 'max:10000000'],
            'monthlySendLimit' => ['required', 'integer', 'min:0', 'max:100000000'],
            'requireCampaignReview' => ['required', 'boolean'],
            'pricingPlanId' => ['nullable', 'uuid'],
        ];
    }

    /** @return array{dailySendLimit: int, monthlySendLimit: int, requireCampaignReview: bool, pricingPlanId: ?string} */
    public function payload(): array
    {
        return [
            'dailySendLimit' => (int) $this->input('dailySendLimit'),
            'monthlySendLimit' => (int) $this->input('monthlySendLimit'),
            'requireCampaignReview' => $this->flag('requireCampaignReview'),
            'pricingPlanId' => $this->clean('pricingPlanId'),
        ];
    }
}
