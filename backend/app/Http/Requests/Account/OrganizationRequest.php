<?php

namespace App\Http\Requests\Account;

use App\Http\Requests\ApiRequest;

class OrganizationRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'industry' => ['nullable', 'string', 'max:60'],
            'website' => ['nullable', 'string', 'max:200', 'regex:/^https?:\/\/[^\s]+\.[^\s]+/'],
            'address' => ['nullable', 'string', 'max:300'],
            'billingEmail' => ['nullable', 'string', 'max:254', 'email:rfc'],
            'taxId' => ['nullable', 'string', 'max:30'],
        ];
    }

    public function messages(): array
    {
        return ['name.*' => 'Enter the organization name.', 'website.regex' => 'Enter a full URL starting with https://', 'billingEmail.*' => 'Enter a valid email address.'];
    }

    public function payload(): array
    {
        $email = $this->clean('billingEmail');

        return [
            'name' => trim($this->input('name')),
            'industry' => $this->clean('industry'),
            'website' => $this->clean('website'),
            'address' => $this->clean('address'),
            'billingEmail' => $email ? strtolower($email) : null,
            'taxId' => $this->clean('taxId'),
        ];
    }
}
