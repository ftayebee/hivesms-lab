<?php

namespace App\Http\Requests\Contacts;

use App\Http\Requests\ApiRequest;

class GroupRequest extends ApiRequest
{
    public function rules(): array
    {
        return ['name' => ['required', 'string', 'min:1', 'max:80'], 'description' => ['nullable', 'string', 'max:300']];
    }

    public function messages(): array
    {
        return ['name.required' => 'Enter a group name.'];
    }

    /** @return array{name: string, description: ?string} */
    public function payload(): array
    {
        return ['name' => trim($this->input('name')), 'description' => $this->clean('description')];
    }
}
