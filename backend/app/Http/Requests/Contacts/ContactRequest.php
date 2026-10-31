<?php

namespace App\Http\Requests\Contacts;

use App\Http\Requests\ApiRequest;
use App\Rules\BdPhone;
use App\Support\Phone;
use Closure;

/**
 * Create / update a contact (port of contactSchema). customFields may be an object
 * {"key": "value"} or the dashboard's "key=value" lines.
 */
class ContactRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['nullable', 'string', 'max:120'],
            'phone' => ['required', 'string', new BdPhone('Enter a valid Bangladesh mobile number, e.g. 01712345678.')],
            'email' => ['nullable', 'string', 'max:254', 'email:rfc'],
            'company' => ['nullable', 'string', 'max:120'],
            'tags' => ['nullable'],
            'tags.*' => ['string', 'max:40'],
            'groupIds' => ['nullable', 'array', 'max:50'],
            'groupIds.*' => ['uuid'],
            'consentStatus' => ['nullable', 'in:OPTED_IN,UNKNOWN,OPTED_OUT'],
            'consentSource' => ['nullable', 'string', 'max:120'],
            'customFields' => ['nullable', function (string $attr, mixed $value, Closure $fail) {
                $parsed = self::parseCustomFields($value);
                if (is_string($parsed)) {
                    $fail($parsed);
                }
            }],
        ];
    }

    public function messages(): array
    {
        return ['phone.required' => 'Enter a mobile number.', 'email.*' => 'Enter a valid email address.', 'tags.*.max' => 'Tags can be at most 40 characters.'];
    }

    /** @return array<string, string>|string the fields, or an error message */
    public static function parseCustomFields(mixed $value): array|string
    {
        $pairs = [];
        if (is_array($value)) {
            foreach ($value as $k => $v) {
                $pairs[] = [(string) $k, is_scalar($v) ? (string) $v : ''];
            }
        } else {
            foreach (preg_split('/\r?\n/', (string) ($value ?? '')) ?: [] as $line) {
                if (trim($line) === '') {
                    continue;
                }
                $idx = strpos($line, '=');
                $pairs[] = [$idx === false ? $line : substr($line, 0, $idx), $idx === false ? '' : substr($line, $idx + 1)];
            }
        }
        $out = [];
        foreach ($pairs as [$k, $v]) {
            $key = preg_replace('/[^a-z0-9_]/', '_', strtolower(trim($k)));
            if ($key === '') {
                continue;
            }
            if (! preg_match('/^[a-z][a-z0-9_]{0,39}$/', $key)) {
                return "Invalid field name \"{$key}\". Use letters, digits and underscores.";
            }
            $out[$key] = mb_substr(trim($v), 0, 500);
        }
        if (count($out) > 30) {
            return 'At most 30 custom fields.';
        }

        return $out;
    }

    /** @return array{name: ?string, phone: string, email: ?string, company: ?string, tags: list<string>, groupIds: list<string>, consentStatus: string, consentSource: ?string, customFields: array<string, string>} */
    public function payload(): array
    {
        $tags = array_slice(array_values(array_unique(array_filter(array_map(
            fn ($t) => preg_replace('/\s+/', '-', mb_strtolower(trim($t))),
            $this->items('tags', '/,/'),
        )))), 0, 20);
        $email = $this->clean('email');
        $fields = self::parseCustomFields($this->input('customFields'));

        return [
            'name' => $this->clean('name'),
            'phone' => Phone::normalize($this->input('phone')),
            'email' => $email ? strtolower($email) : null,
            'company' => $this->clean('company'),
            'tags' => $tags,
            'groupIds' => array_values(array_unique($this->items('groupIds'))),
            'consentStatus' => $this->input('consentStatus') ?: 'UNKNOWN',
            'consentSource' => $this->clean('consentSource'),
            'customFields' => is_array($fields) ? $fields : [],
        ];
    }
}
