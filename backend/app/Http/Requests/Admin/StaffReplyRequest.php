<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

class StaffReplyRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'min:1', 'max:10000'],
            'internal' => ['boolean'],
            'status' => ['nullable', 'in:OPEN,IN_PROGRESS,WAITING_FOR_CUSTOMER,RESOLVED,CLOSED'],
        ];
    }

    public function messages(): array
    {
        return ['body.*' => 'Write a reply.'];
    }
}
