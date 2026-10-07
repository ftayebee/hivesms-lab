<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\ApiRequest;
use App\Rules\BdPhone;
use App\Services\Auth\PasswordHasher;
use App\Support\Phone;

class RegisterRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['email' => is_string($this->email) ? strtolower(trim($this->email)) : $this->email]);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:100'],
            'company' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['required', 'string', 'max:254', 'email:rfc'],
            'phone' => ['required', 'string', new BdPhone],
            'password' => ['required', ...PasswordHasher::rules()],
            'confirmPassword' => ['required', 'same:password'],
            'acceptTerms' => ['accepted'],
        ];
    }

    public function messages(): array
    {
        return PasswordHasher::messages() + [
            'name.*' => 'Enter your full name.',
            'company.*' => 'Enter your company or organization name.',
            'email.*' => 'Enter a valid email address.',
            'confirmPassword.same' => 'Passwords do not match.',
            'acceptTerms.accepted' => 'You must accept the Terms and Privacy Policy.',
        ];
    }

    /** @return array{name: string, company: string, email: string, phone: string, password: string} */
    public function payload(): array
    {
        return [
            'name' => trim($this->input('name')),
            'company' => trim($this->input('company')),
            'email' => $this->input('email'),
            'phone' => Phone::normalize($this->input('phone')),
            'password' => (string) $this->input('password'),
        ];
    }
}
