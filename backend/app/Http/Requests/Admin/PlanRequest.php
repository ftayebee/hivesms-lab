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
        $rate = ['required', 'numeric', 'min:0', 'max:100'];

        return [
            'key' => ['required', 'string', 'regex:/^[a-z0-9-]{2,30}$/'],
            'name' => ['required', 'string', 'min:2', 'max:40'],
            'description' => ['nullable', 'string', 'max:200'],
            'minRechargeAmount' => ['required', 'numeric', 'min:0', 'max:10000000'],
            'transactionalNonMasking' => $rate,
            'transactionalMasking' => $rate,
            'promotionalNonMasking' => $rate,
            'promotionalMasking' => $rate,
            'senderIdFee' => ['required', 'numeric', 'min:0', 'max:100000'],
            'features' => ['nullable'],
            'isCustom' => ['boolean'], 'isPublic' => ['boolean'], 'isDefault' => ['boolean'], 'highlighted' => ['boolean'], 'active' => ['boolean'],
            'sortOrder' => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }

    public function messages(): array
    {
        return ['key.regex' => 'Use lower-case letters, digits and hyphens.'];
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
}
