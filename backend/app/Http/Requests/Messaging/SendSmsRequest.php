<?php

namespace App\Http\Requests\Messaging;

use App\Http\Requests\ApiRequest;
use Carbon\CarbonImmutable;

/**
 * POST /api/v1/sms/send — public API contract (port of sendSmsBody, strict: unknown fields are
 * rejected). `type` defaults to transactional; `schedule_at` is ISO-8601 with offset.
 */
class SendSmsRequest extends ApiRequest
{
    protected const ALLOWED = ['to', 'message', 'sender_id', 'type', 'reference', 'schedule_at'];

    public function rules(): array
    {
        return [
            '_unknown' => ['prohibited'],
            'to' => ['required', 'string', 'max:32'],
            'message' => ['required', 'string', 'max:3000'],
            'sender_id' => ['nullable', 'string', 'max:20'],
            'type' => ['nullable', 'in:transactional,promotional,TRANSACTIONAL,PROMOTIONAL'],
            'reference' => ['nullable', 'string', 'max:100'],
            'schedule_at' => ['nullable', 'string', 'date_format:Y-m-d\TH:i:sP,Y-m-d\TH:i:s.vP,Y-m-d\TH:i:s\Z,Y-m-d\TH:i:s.v\Z,Y-m-d\TH:iP'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $unknown = array_diff(array_keys($this->json()->all()), static::ALLOWED);
        if ($unknown) {
            $this->merge(['_unknown' => implode(', ', $unknown)]);
        }
    }

    public function messages(): array
    {
        return [
            '_unknown.prohibited' => 'Unrecognized key(s) in object: '.($this->input('_unknown') ?? ''),
            'to.required' => 'to is required',
            'message.required' => 'message is required',
            'schedule_at.date_format' => 'schedule_at must be an ISO 8601 date-time, e.g. 2026-10-01T10:00:00+06:00',
        ];
    }

    public function smsType(): string
    {
        return strtoupper($this->input('type') ?: 'transactional');
    }

    public function scheduleAt(): ?CarbonImmutable
    {
        $v = $this->input('schedule_at');

        return $v ? CarbonImmutable::parse($v)->utc() : null;
    }
}
