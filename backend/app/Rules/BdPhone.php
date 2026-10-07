<?php

namespace App\Rules;

use App\Support\Phone;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/** Valid Bangladesh mobile number in any accepted input form (normalised later with Phone::normalize). */
class BdPhone implements ValidationRule
{
    public function __construct(private readonly string $message = 'Enter a valid Bangladesh mobile number, e.g. 01712345678.') {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || Phone::normalize($value) === null) {
            $fail($this->message);
        }
    }
}
