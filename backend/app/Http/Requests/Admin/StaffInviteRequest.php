<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

/** POST /admin/staff {email, name, role, reason, currentPassword}. */
class StaffInviteRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email:rfc', 'max:254'],
            'name' => ['required', 'string', 'min:2', 'max:100'],
            'role' => ['required', 'in:SUPPORT,ADMIN,SUPER_ADMIN'],
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ];
    }

    public function messages(): array
    {
        return ['reason.*' => 'Give a reason (at least 5 characters).', 'currentPassword.*' => 'Confirm with your current password.'];
    }
}
