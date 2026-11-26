<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;
use App\Rules\BdPhone;
use App\Services\Auth\PasswordHasher;
use App\Support\Phone;

/** POST /admin/customers: a super admin opens a customer account with a password (same rules as sign-up). */
class CreateCustomerRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['email' => is_string($this->email) ? strtolower(trim($this->email)) : $this->email]);
    }

    public function rules(): array
    {
        return [
            'company' => ['required', 'string', 'min:2', 'max:120'],
            'name' => ['required', 'string', 'min:2', 'max:100'],
            'email' => ['required', 'string', 'max:254', 'email:rfc'],
            'phone' => ['nullable', 'string', new BdPhone],
            'password' => ['required', ...PasswordHasher::rules()],
            'confirmPassword' => ['required', 'same:password'],
            'pricingPlanId' => ['nullable', 'uuid'],
            'emailVerified' => ['nullable', 'boolean'],
            'sendWelcome' => ['nullable', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return PasswordHasher::messages() + [
            'company.*' => 'Enter the company or organization name.',
            'name.*' => 'Enter the account owner\'s full name.',
            'email.*' => 'Enter a valid email address.',
            'confirmPassword.same' => 'Passwords do not match.',
            'pricingPlanId.*' => 'Choose a pricing plan from the list.',
        ];
    }

    /** @return array{company: string, name: string, email: string, phone: ?string, password: string, pricingPlanId: ?string, emailVerified: bool, sendWelcome: bool} */
    public function payload(): array
    {
        $phone = trim((string) $this->input('phone', ''));

        return [
            'company' => trim((string) $this->input('company')),
            'name' => trim((string) $this->input('name')),
            'email' => (string) $this->input('email'),
            'phone' => $phone === '' ? null : Phone::normalize($phone),
            'password' => (string) $this->input('password'),
            'pricingPlanId' => $this->input('pricingPlanId') ?: null,
            'emailVerified' => $this->has('emailVerified') ? $this->boolean('emailVerified') : true,
            'sendWelcome' => $this->boolean('sendWelcome'),
        ];
    }
}
