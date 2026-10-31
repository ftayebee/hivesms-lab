<?php

namespace App\Http\Requests\PublicForms;

use App\Http\Requests\ApiRequest;
use App\Support\Phone;
use Closure;

/** Website contact/sales form. `website` is a honeypot that must stay empty. */
class ContactFormRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['email' => is_string($this->email) ? strtolower(trim($this->email)) : $this->email]);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:100'],
            'company' => ['nullable', 'string', 'max:120'],
            'email' => ['required', 'string', 'max:254', 'email:rfc'],
            'phone' => ['nullable', 'string', 'max:30', function (string $a, mixed $v, Closure $fail) {
                if ($v && ! Phone::normalize((string) $v) && ! preg_match('/^\+?[\d\s-]{7,20}$/', (string) $v)) {
                    $fail('Enter a valid phone number.');
                }
            }],
            'subject' => ['required', 'string', 'min:3', 'max:150'],
            'message' => ['required', 'string', 'min:10', 'max:5000'],
            'website' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return ['name.*' => 'Enter your name.', 'email.*' => 'Enter a valid email address.', 'subject.*' => 'Enter a subject.', 'message.*' => 'Tell us a little more (at least 10 characters).'];
    }
}
