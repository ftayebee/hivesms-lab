<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\ApiRequest;

/**
 * Platform settings sections (port of the admin config schemas). The section comes from the
 * route: billing-policy | sms-policy | sms-provider | payments | site-content. Secret fields are
 * write-only: empty = keep, clear* = remove.
 */
class SettingsRequest extends ApiRequest
{
    public function section(): string
    {
        return (string) $this->route('section');
    }

    public function rules(): array
    {
        return match ($this->section()) {
            'billing-policy' => [
                'vatRatePercent' => ['required', 'numeric', 'min:0', 'max:50'],
                'minimumTopUp' => ['required', 'numeric', 'min:0', 'max:1000000'],
                'maximumTopUp' => ['required', 'numeric', 'min:0', 'max:100000000'],
                'balanceValidityMonths' => ['nullable', 'integer', 'min:0', 'max:120'],
                'invoicePrefix' => ['required', 'string', 'regex:/^[A-Z0-9-]{2,10}$/'],
            ],
            'sms-policy' => [
                'gsmSingle' => ['required', 'integer', 'min:1', 'max:1000'], 'gsmMulti' => ['required', 'integer', 'min:1', 'max:1000'],
                'ucsSingle' => ['required', 'integer', 'min:1', 'max:1000'], 'ucsMulti' => ['required', 'integer', 'min:1', 'max:1000'],
                'maxSegments' => ['required', 'integer', 'min:1', 'max:20'],
                'refundFailedMessages' => ['boolean'], 'quietHoursEnabled' => ['boolean'],
                'quietStart' => ['required', 'integer', 'min:0', 'max:23'], 'quietEnd' => ['required', 'integer', 'min:0', 'max:23'],
                'appendOptOutText' => ['boolean'], 'promotionalOptOutText' => ['nullable', 'string', 'max:60'],
                'reviewThresholdRecipients' => ['required', 'integer', 'min:1', 'max:10000000'],
                'optOutKeywords' => ['required', 'string', 'max:500'],
            ],
            'sms-provider' => [
                'provider' => ['required', 'in:mock,http,automas'], 'url' => ['nullable', 'string', 'max:500'],
                'apiKey' => ['nullable', 'string', 'max:500'], 'apiSecret' => ['nullable', 'string', 'max:500'], 'webhookSecret' => ['nullable', 'string', 'max:500'],
                'clearSecrets' => ['boolean'],
                'mapTo' => ['nullable', 'string', 'max:40'], 'mapMessage' => ['nullable', 'string', 'max:40'], 'mapSenderId' => ['nullable', 'string', 'max:40'], 'mapApiKey' => ['nullable', 'string', 'max:40'],
            ],
            'payments' => [
                'enabled' => ['nullable', 'array'], 'enabled.*' => ['in:mock,manual,sslcommerz'],
                'manualInstructions' => ['required', 'string', 'min:10', 'max:2000'],
                'sslStoreId' => ['nullable', 'string', 'max:100'], 'sslStorePassword' => ['nullable', 'string', 'max:200'],
                'sslLive' => ['boolean'], 'clearSslPassword' => ['boolean'],
            ],
            'site-content' => [
                'email' => ['nullable', 'string', 'max:120'], 'supportEmail' => ['nullable', 'string', 'max:120'], 'salesEmail' => ['nullable', 'string', 'max:120'],
                'abuseEmail' => ['nullable', 'string', 'max:120'], 'phone' => ['nullable', 'string', 'max:40'], 'address' => ['nullable', 'string', 'max:300'],
                'hours' => ['nullable', 'string', 'max:120'], 'announcementEnabled' => ['boolean'], 'announcementText' => ['nullable', 'string', 'max:200'],
                'announcementHref' => ['nullable', 'string', 'max:300'],
            ],
            default => ['_section' => ['required']],
        };
    }

    public function messages(): array
    {
        return ['invoicePrefix.regex' => '2 to 10 upper-case letters, digits or hyphens.', 'manualInstructions.*' => 'Explain how to pay offline.', '_section.required' => 'Unknown settings section.'];
    }

    /** Validated values with booleans normalised and strings defaulted. */
    public function payload(): array
    {
        $v = $this->validated();
        foreach (['refundFailedMessages', 'quietHoursEnabled', 'appendOptOutText', 'clearSecrets', 'sslLive', 'clearSslPassword', 'announcementEnabled'] as $b) {
            if (array_key_exists($b, $this->rules())) {
                $v[$b] = $this->flag($b);
            }
        }
        foreach ($this->rules() as $key => $rule) {
            if (! str_contains($key, '.') && ! array_key_exists($key, $v) && in_array('nullable', (array) $rule, true)) {
                $v[$key] = $key === 'enabled' ? [] : '';
            }
        }

        return $v;
    }
}
