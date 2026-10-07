<?php

namespace App\Http\Requests\Messaging;

use App\Http\Requests\ApiRequest;

/**
 * Campaign composer (port of composerSchema): drafts accept partial content; submit/estimate
 * re-validate fully in the service. `numbers` is pasted text (comma/space/newline separated) or an
 * array; `scheduledAt` is Dhaka wall time "YYYY-MM-DDTHH:MM" or ISO-8601 with an offset.
 */
class CampaignRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'id' => ['nullable', 'uuid'],
            'name' => ['nullable', 'string', 'max:120'],
            'smsType' => ['required', 'in:TRANSACTIONAL,PROMOTIONAL'],
            'senderId' => ['nullable', 'string', 'max:20'],
            'templateId' => ['nullable', 'uuid'],
            'message' => ['present', 'nullable', 'string', 'max:3000'],
            'groupIds' => ['nullable', 'array', 'max:50'],
            'groupIds.*' => ['uuid'],
            'numbers' => ['nullable'],
            'scheduleMode' => ['nullable', 'in:now,later'],
            'scheduledAt' => ['nullable', 'string', 'max:40'],
        ];
    }

    public function messages(): array
    {
        return ['message.max' => 'Message is too long.'];
    }

    /** @return array<string, mixed> composer input for CampaignService */
    public function payload(): array
    {
        $numbers = $this->input('numbers');
        if (is_array($numbers)) {
            $numbers = implode("\n", array_filter($numbers, 'is_scalar'));
        }
        if (is_string($numbers) && strlen($numbers) > 3000000) {
            $numbers = substr($numbers, 0, 3000000);
        }

        return [
            'id' => $this->clean('id'),
            'name' => (string) ($this->input('name') ?? ''),
            'smsType' => $this->input('smsType'),
            'senderId' => (string) ($this->clean('senderId') ?? ''),
            'templateId' => $this->clean('templateId'),
            'message' => (string) ($this->input('message') ?? ''),
            'groupIds' => array_values(array_unique($this->items('groupIds'))),
            'numbers' => (string) ($numbers ?? ''),
            'scheduleMode' => $this->input('scheduleMode') ?: 'now',
            'scheduledAt' => (string) ($this->input('scheduledAt') ?? ''),
        ];
    }
}
