<?php

namespace App\Http\Requests\Developers;

use App\Http\Requests\ApiRequest;
use App\Services\Messaging\OutboundWebhookService;

class WebhookEndpointRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'url' => ['required', 'string', 'max:500', 'url:https,http'],
            'description' => ['nullable', 'string', 'max:200'],
            'events' => ['required', 'array', 'min:1'],
            'events.*' => ['in:'.implode(',', array_keys(OutboundWebhookService::EVENTS))],
        ];
    }

    public function messages(): array
    {
        return ['url.*' => 'Enter a valid URL.', 'events.required' => 'Select at least one event.', 'events.min' => 'Select at least one event.'];
    }

    /** @return array{url: string, description: ?string, events: list<string>} */
    public function payload(): array
    {
        return ['url' => trim($this->input('url')), 'description' => $this->clean('description'), 'events' => array_values(array_unique($this->input('events')))];
    }
}
