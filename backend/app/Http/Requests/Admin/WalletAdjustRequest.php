<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

class WalletAdjustRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'direction' => ['required', 'in:CREDIT,DEBIT'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:10000000', 'decimal:0,2'],
            'note' => ['required', 'string', 'min:5', 'max:300'],
        ];
    }

    public function messages(): array
    {
        return ['amount.*' => 'Enter an amount (up to 2 decimals).', 'note.*' => 'Explain the adjustment (visible to the customer).'];
    }
}
