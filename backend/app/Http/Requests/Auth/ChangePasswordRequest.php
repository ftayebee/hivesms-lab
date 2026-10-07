<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\ApiRequest;
use App\Services\Auth\PasswordHasher;

class ChangePasswordRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'currentPassword' => ['required', 'string', 'max:128'],
            'password' => ['required', ...PasswordHasher::rules()],
            'confirmPassword' => ['required', 'same:password'],
        ];
    }

    public function messages(): array
    {
        return PasswordHasher::messages() + [
            'currentPassword.required' => 'Enter your current password.',
            'confirmPassword.same' => 'Passwords do not match.',
        ];
    }
}
