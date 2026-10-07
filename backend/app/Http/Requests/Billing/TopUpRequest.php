<?php

namespace App\Http\Requests\Billing;

use App\Http\Requests\ApiRequest;

/** Top-up: a credit package or a custom amount, and a payment provider (preview omits the provider). */
class TopUpRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'packageId' => ['nullable', 'uuid', 'required_without:amount'],
            'amount' => ['nullable', 'numeric', 'gt:0', 'max:10000000', 'required_without:packageId'],
            'provider' => [$this->routeIs('*.preview') ? 'nullable' : 'required', 'string', 'max:30'],
        ];
    }

    public function messages(): array
    {
        return [
            'packageId.required_without' => 'Choose a package or enter an amount.',
            'amount.required_without' => 'Choose a package or enter an amount.',
            'amount.*' => 'Enter an amount.',
            'provider.required' => 'Choose a payment method.',
        ];
    }

    public function amount(): ?string
    {
        $v = $this->input('amount');

        return $v === null || $v === '' ? null : (string) $v;
    }
}
