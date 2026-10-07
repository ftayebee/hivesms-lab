<?php

namespace App\Http\Requests\Account;

use App\Http\Requests\ApiRequest;

class TeamInviteRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['email' => is_string($this->email) ? strtolower(trim($this->email)) : $this->email]);
    }

    public function rules(): array
    {
        return ['email' => ['required', 'string', 'max:254', 'email:rfc'], 'role' => ['required', 'in:OWNER,ADMIN,MANAGER,DEVELOPER,VIEWER']];
    }

    public function messages(): array
    {
        return ['email.*' => 'Enter a valid email address.'];
    }
}
