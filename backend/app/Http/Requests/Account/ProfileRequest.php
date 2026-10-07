<?php

namespace App\Http\Requests\Account;

use App\Http\Requests\ApiRequest;
use App\Rules\BdPhone;
use App\Support\Phone;

class ProfileRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:100'],
            'phone' => ['nullable', 'string', new BdPhone('Enter a valid Bangladesh mobile number.')],
            'locale' => ['nullable', 'in:en,bn'],
        ];
    }

    public function messages(): array
    {
        return ['name.*' => 'Enter your name.'];
    }

    /** @return array{name: string, phone: ?string, locale: string} */
    public function payload(): array
    {
        $phone = $this->clean('phone');

        return ['name' => trim($this->input('name')), 'phone' => $phone ? Phone::normalize($phone) : null, 'locale' => $this->input('locale') ?: 'en'];
    }
}
