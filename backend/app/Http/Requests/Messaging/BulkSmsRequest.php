<?php

namespace App\Http\Requests\Messaging;

use Closure;

/**
 * POST /api/v1/sms/bulk — public API contract (port of bulkSmsBody): up to 1,000 recipients, each a
 * number string or {to, message?, variables?}.
 */
class BulkSmsRequest extends SendSmsRequest
{
    protected const ALLOWED = ['recipients', 'message', 'sender_id', 'type', 'reference', 'schedule_at'];

    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['to']);

        return $rules + [
            'recipients' => ['required', 'array', 'min:1', 'max:1000'],
            'recipients.*' => [function (string $attr, mixed $v, Closure $fail) {
                if (is_string($v)) {
                    if (mb_strlen(trim($v)) > 32) {
                        $fail('Recipient numbers are at most 32 characters.');
                    }

                    return;
                }
                if (! is_array($v) || ! isset($v['to']) || ! is_string($v['to']) || mb_strlen(trim($v['to'])) > 32) {
                    $fail('Each recipient is a number or an object with "to".');

                    return;
                }
                if ($extra = array_diff(array_keys($v), ['to', 'message', 'variables'])) {
                    $fail('Unrecognized key(s) in recipient: '.implode(', ', $extra));
                }
                if (isset($v['message']) && (! is_string($v['message']) || $v['message'] === '' || mb_strlen($v['message']) > 3000)) {
                    $fail('Recipient message must be 1 to 3000 characters.');
                }
                if (isset($v['variables'])) {
                    if (! is_array($v['variables'])) {
                        $fail('variables must be an object of strings.');

                        return;
                    }
                    foreach ($v['variables'] as $k => $val) {
                        if (! is_string($k) || mb_strlen($k) > 40 || ! is_string($val) || mb_strlen($val) > 500) {
                            $fail('variables must map names (≤ 40 chars) to strings (≤ 500 chars).');

                            return;
                        }
                    }
                }
            }],
        ];
    }

    public function messages(): array
    {
        return parent::messages() + [
            'recipients.required' => 'recipients must contain at least one entry',
            'recipients.min' => 'recipients must contain at least one entry',
            'recipients.max' => 'recipients can contain at most 1,000 entries',
        ];
    }

    /** @return list<array{phone: string, message?: ?string, variables?: ?array}> */
    public function recipients(): array
    {
        return array_map(fn ($r) => is_string($r)
            ? ['phone' => trim($r)]
            : ['phone' => trim($r['to']), 'message' => $r['message'] ?? null, 'variables' => $r['variables'] ?? null], $this->input('recipients'));
    }
}
