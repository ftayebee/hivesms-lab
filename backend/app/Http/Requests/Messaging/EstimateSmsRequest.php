<?php

namespace App\Http\Requests\Messaging;

/** POST /api/v1/sms/estimate (port of estimateBody). */
class EstimateSmsRequest extends SendSmsRequest
{
    protected const ALLOWED = ['message', 'recipients', 'sender_id', 'type'];

    public function rules(): array
    {
        return [
            '_unknown' => ['prohibited'],
            'message' => ['required', 'string', 'min:1', 'max:3000'],
            'recipients' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'sender_id' => ['nullable', 'string', 'max:20'],
            'type' => ['nullable', 'in:transactional,promotional,TRANSACTIONAL,PROMOTIONAL'],
        ];
    }
}
