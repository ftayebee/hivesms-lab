<?php

namespace App\Http\Requests\Developers;

use App\Auth\Permissions;
use App\Http\Requests\ApiRequest;
use Closure;

class ApiKeyRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:60'],
            'scopes' => ['required', 'array', 'min:1'],
            'scopes.*' => ['in:'.implode(',', array_keys(Permissions::API_SCOPES))],
            'ipAllowlist' => ['nullable', function (string $a, mixed $v, Closure $fail) {
                $ips = $this->items('ipAllowlist');
                foreach ($ips as $ip) {
                    if (! filter_var($ip, FILTER_VALIDATE_IP)) {
                        $fail("\"{$ip}\" is not a valid IP address.");
                    }
                }
                if (count($ips) > 20) {
                    $fail('At most 20 addresses.');
                }
            }],
            'expiresInDays' => ['nullable', 'in:30,90,180,365'],
        ];
    }

    public function messages(): array
    {
        return ['name.*' => 'Name the key after the service that uses it.', 'scopes.required' => 'Select at least one scope.', 'scopes.min' => 'Select at least one scope.'];
    }

    /** @return array{name: string, scopes: list<string>, ipAllowlist: list<string>, expiresInDays: ?int} */
    public function payload(): array
    {
        return [
            'name' => trim($this->input('name')),
            'scopes' => array_values(array_unique($this->input('scopes'))),
            'ipAllowlist' => array_values(array_unique($this->items('ipAllowlist'))),
            'expiresInDays' => $this->input('expiresInDays') ? (int) $this->input('expiresInDays') : null,
        ];
    }
}
