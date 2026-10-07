<?php

namespace App\Http\Requests\PublicForms;

use App\Http\Requests\ApiRequest;

class AbuseReportRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'reporterName' => ['nullable', 'string', 'max:100'],
            'reporterEmail' => ['nullable', 'string', 'max:254', 'email:rfc'],
            'reporterPhone' => ['nullable', 'string', 'max:30'],
            'senderValue' => ['required', 'string', 'min:2', 'max:30'],
            'messageContent' => ['required', 'string', 'min:5', 'max:2000'],
            'receivedAt' => ['nullable', 'string', 'max:40'],
            'description' => ['nullable', 'string', 'max:2000'],
            'website' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return ['senderValue.*' => 'Enter the sender name or number shown on the message.', 'messageContent.*' => 'Paste the message you received.', 'reporterEmail.*' => 'Enter a valid email address.'];
    }
}
