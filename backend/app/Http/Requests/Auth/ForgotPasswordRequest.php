<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\ApiRequest;

class ForgotPasswordRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['email' => is_string($this->email) ? strtolower(trim($this->email)) : $this->email]);
    }

    public function rules(): array
    {
        return ['email' => ['required', 'string', 'max:254', 'email:rfc']];
    }

    public function messages(): array
    {
        return ['email.*' => 'Enter a valid email address.'];
    }
}
