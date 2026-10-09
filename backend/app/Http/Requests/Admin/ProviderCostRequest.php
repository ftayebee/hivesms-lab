<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

/**
 * PUT /admin/finance/provider-costs. Verified wholesale rates per SMS segment in BDT (never
 * invented defaults). Changing these never changes the sending provider or its configuration.
 */
class ProviderCostRequest extends ApiRequest
{
    public function rules(): array
    {
        $rate = ['required', 'string', 'regex:/^\d{1,3}(\.\d{1,4})?$/'];

        return [
            'provider' => ['required', 'string', 'regex:/^[a-z0-9_-]{2,30}$/'],
            'rates' => ['required', 'array'],
            'rates.transactionalMasking' => $rate,
            'rates.transactionalNonMasking' => $rate,
            'rates.promotionalMasking' => $rate,
            'rates.promotionalNonMasking' => $rate,
            'effectiveFrom' => ['required', 'date_format:Y-m-d'],
            'source' => ['required', 'string', 'min:5', 'max:300'],
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ];
    }

    public function messages(): array
    {
        return [
            'rates.*' => 'Enter a rate in BDT per segment (up to 4 decimals).',
            'source.*' => 'Say where the rate comes from (contract, invoice number…).',
            'reason.*' => 'Give a reason (at least 5 characters).',
            'currentPassword.*' => 'Confirm with your current password.',
        ];
    }
}
