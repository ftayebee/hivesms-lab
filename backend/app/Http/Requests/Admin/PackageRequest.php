<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

class PackageRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:40'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:10000000'],
            'bonusPercent' => ['required', 'numeric', 'min:0', 'max:50'],
            'description' => ['nullable', 'string', 'max:200'],
            'active' => ['boolean'],
            'sortOrder' => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }

    public function payload(): array
    {
        return [
            'name' => trim($this->input('name')), 'amount' => (string) $this->input('amount'), 'bonusPercent' => (string) $this->input('bonusPercent'),
            'description' => $this->clean('description'), 'active' => $this->flag('active'), 'sortOrder' => (int) ($this->input('sortOrder') ?? 0),
        ];
    }
}
