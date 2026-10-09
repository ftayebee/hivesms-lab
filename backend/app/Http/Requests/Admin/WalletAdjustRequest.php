<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

/**
 * POST /admin/customers/{id}/wallet-adjustments. Money is a plain decimal string (no floats, no
 * exponents); the idempotency key (body or Idempotency-Key header) makes retries safe; the acting
 * super admin re-confirms their password. `note` is accepted as the legacy name of `reason`.
 */
class WalletAdjustRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge([
            'reason' => $this->input('reason') ?? $this->input('note'),
            'idempotencyKey' => $this->input('idempotencyKey') ?? $this->header('Idempotency-Key'),
        ]);
    }

    public function rules(): array
    {
        return [
            'direction' => ['required', 'in:CREDIT,DEBIT'],
            'amount' => ['required', 'regex:/^\d{1,8}(\.\d{1,2})?$/', 'not_regex:/^0+(\.0+)?$/'],
            'reason' => ['required', 'string', 'min:5', 'max:300'],
            'idempotencyKey' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{16,100}$/'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ];
    }

    public function messages(): array
    {
        return [
            'amount.*' => 'Enter an amount greater than 0 (up to 2 decimals).',
            'reason.*' => 'Explain the adjustment (at least 5 characters; visible to the customer).',
            'idempotencyKey.*' => 'Missing request key. Reload the page and try again.',
            'currentPassword.*' => 'Confirm with your current password.',
        ];
    }
}
