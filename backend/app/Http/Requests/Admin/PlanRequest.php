<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

class PlanRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['key' => is_string($this->key) ? strtolower(trim($this->key)) : $this->key]);
    }

    public function rules(): array
    {
        // Plain decimals only (no exponent notation); stored as DECIMAL, never as floats.
        $rate = ['required', 'numeric', 'min:0', 'max:100', 'regex:/^\d{1,3}(\.\d{1,4})?$/'];

        return [
            'key' => ['required', 'string', 'regex:/^[a-z0-9-]{2,30}$/'],
            'name' => ['required', 'string', 'min:2', 'max:40'],
            'description' => ['nullable', 'string', 'max:200'],
            'minRechargeAmount' => ['required', 'numeric', 'min:0', 'max:10000000', 'regex:/^\d{1,8}(\.\d{1,4})?$/'],
            'transactionalNonMasking' => $rate,
            'transactionalMasking' => $rate,
            'promotionalNonMasking' => $rate,
            'promotionalMasking' => $rate,
            'senderIdFee' => ['required', 'numeric', 'min:0', 'max:100000', 'regex:/^\d{1,6}(\.\d{1,4})?$/'],
            // Changing an existing plan needs a reason (recorded with before/after in the audit log).
            'reason' => [$this->route('id') ? 'required' : 'nullable', 'string', 'min:5', 'max:500'],
            'features' => ['nullable'],
            'isCustom' => ['boolean'], 'isPublic' => ['boolean'], 'isDefault' => ['boolean'], 'highlighted' => ['boolean'], 'active' => ['boolean'],
            'sortOrder' => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }

    public function messages(): array
    {
        return [
            'key.regex' => 'Use lower-case letters, digits and hyphens.',
            'reason.*' => 'Say why the plan changes (at least 5 characters).',
            '*.regex' => 'Enter a plain amount (no exponent notation, up to 4 decimals for rates).',
        ];
    }

    public function payload(): array
    {
        return [
            'key' => $this->input('key'),
            'name' => trim($this->input('name')),
            'description' => $this->clean('description'),
            'minRechargeAmount' => (string) $this->input('minRechargeAmount'),
            'transactionalNonMasking' => (string) $this->input('transactionalNonMasking'),
            'transactionalMasking' => (string) $this->input('transactionalMasking'),
            'promotionalNonMasking' => (string) $this->input('promotionalNonMasking'),
            'promotionalMasking' => (string) $this->input('promotionalMasking'),
            'senderIdFee' => (string) $this->input('senderIdFee'),
            'features' => array_slice($this->items('features', '/\r?\n/'), 0, 12),
            'isCustom' => $this->flag('isCustom'), 'isPublic' => $this->flag('isPublic'), 'isDefault' => $this->flag('isDefault'),
            'highlighted' => $this->flag('highlighted'), 'active' => $this->flag('active'),
            'sortOrder' => (int) ($this->input('sortOrder') ?? 0),
        ];
    }

    public function reason(): ?string
    {
        return $this->clean('reason');
    }
}
