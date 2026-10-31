<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\ApiRequest;
use App\Rules\BdPhone;
use App\Services\Auth\PasswordHasher;

/** New account from an invitation link (the email comes from the invitation). */
class InviteSignupRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'token' => ['required', 'string', 'min:20', 'max:200'],
            'name' => ['required', 'string', 'min:2', 'max:100'],
            'phone' => ['nullable', 'string', new BdPhone('Enter a valid Bangladesh mobile number.')],
            'password' => ['required', ...PasswordHasher::rules()],
            'confirmPassword' => ['required', 'same:password'],
            'remember' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return PasswordHasher::messages() + ['name.*' => 'Enter your full name.', 'confirmPassword.same' => 'Passwords do not match.'];
    }
}
