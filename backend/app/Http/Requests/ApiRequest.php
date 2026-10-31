<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Base Form Request. Authorization is enforced by route middleware (session/tenant/platform
 * permissions) and by the services' ownership scoping, so authorize() is always true here.
 * Failures render as VALIDATION_ERROR with details.fields[{path, message}] (the API contract).
 */
abstract class ApiRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** Trimmed string or null when empty. */
    protected function clean(string $key): ?string
    {
        $v = $this->input($key);
        if ($v === null) {
            return null;
        }
        $v = trim((string) $v);

        return $v === '' ? null : $v;
    }

    /** Accepts an array or a comma/newline separated string. @return list<string> */
    protected function items(string $key, string $separator = '/[\s,]+/'): array
    {
        $v = $this->input($key);
        $items = is_array($v) ? $v : (preg_split($separator, (string) ($v ?? '')) ?: []);

        return array_values(array_filter(array_map(fn ($x) => is_scalar($x) ? trim((string) $x) : '', $items), fn ($x) => $x !== ''));
    }

    protected function flag(string $key): bool
    {
        return filter_var($this->input($key, false), FILTER_VALIDATE_BOOLEAN);
    }
}
