<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

/** PUT /admin/users/{id}/access {platformRole?, status?, reason, currentPassword}. */
class StaffAccessRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'platformRole' => ['nullable', 'in:USER,SUPPORT,ADMIN,SUPER_ADMIN'],
            'status' => ['nullable', 'in:ACTIVE,SUSPENDED'],
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ];
    }

    public function messages(): array
    {
        return ['reason.*' => 'Give a reason (at least 5 characters).', 'currentPassword.*' => 'Confirm with your current password.'];
    }
}
