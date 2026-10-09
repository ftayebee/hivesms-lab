<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

/** POST /admin/payments/{id}/refund {reason, currentPassword}. */
class PaymentRefundRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ];
    }

    public function messages(): array
    {
        return ['reason.*' => 'Give a reason (at least 5 characters).', 'currentPassword.*' => 'Confirm with your current password.'];
    }
}
