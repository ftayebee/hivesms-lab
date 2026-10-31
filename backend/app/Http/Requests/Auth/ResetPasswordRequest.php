<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\ApiRequest;
use App\Services\Auth\PasswordHasher;

class ResetPasswordRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'token' => ['required', 'string', 'min:20', 'max:200'],
            'password' => ['required', ...PasswordHasher::rules()],
            'confirmPassword' => ['required', 'same:password'],
        ];
    }

    public function messages(): array
    {
        return PasswordHasher::messages() + ['confirmPassword.same' => 'Passwords do not match.'];
    }
}
