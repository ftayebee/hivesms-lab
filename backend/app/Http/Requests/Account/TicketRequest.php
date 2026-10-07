<?php

namespace App\Http\Requests\Account;

use App\Http\Requests\ApiRequest;
use App\Services\Support\SupportService;

class TicketRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'subject' => ['required', 'string', 'min:5', 'max:150'],
            'category' => ['required', 'in:'.implode(',', SupportService::CATEGORIES)],
            'priority' => ['nullable', 'in:LOW,NORMAL,HIGH,URGENT'],
            'message' => ['required', 'string', 'min:10', 'max:10000'],
        ];
    }

    public function messages(): array
    {
        return ['subject.*' => 'Describe the issue in a few words.', 'message.*' => 'Add some detail (at least 10 characters).'];
    }

    public function payload(): array
    {
        return ['subject' => trim($this->input('subject')), 'category' => $this->input('category'), 'priority' => $this->input('priority') ?: 'NORMAL', 'message' => trim($this->input('message'))];
    }
}
