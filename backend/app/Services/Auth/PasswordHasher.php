<?php

namespace App\Services\Auth;

use App\Exceptions\AppException;
use App\Support\ErrorCode;
use Illuminate\Validation\ValidationException;

/**
 * argon2id with the Node app's parameters (m=19456 KiB, t=2, p=1), so hashes written by either
 * backend verify in the other and no user ever needs a password reset (port of lib/auth/password.ts).
 */
class PasswordHasher
{
    private const OPTIONS = ['memory_cost' => 19456, 'time_cost' => 2, 'threads' => 1];

    private const COMMON = [
        'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop',
        'iloveyou', 'admin123', 'welcome123', 'bangladesh', 'bangladesh1', 'dhaka1234', '11111111', '00000000',
        'abc12345', 'abcd1234',
    ];

    private ?string $dummyHash = null;

    public function hash(string $password): string
    {
        return password_hash($password, PASSWORD_ARGON2ID, self::OPTIONS);
    }

    public function verify(string $hash, string $password): bool
    {
        try {
            return password_verify($password, $hash);
        } catch (\Throwable) {
            return false;
        }
    }

    /** Spends the same time as a real verification (unknown account / locked account). */
    public function burn(string $password): void
    {
        $this->dummyHash ??= $this->hash('timing-equaliser-not-a-real-password');
        $this->verify($this->dummyHash, $password);
    }

    /** Laravel validation rules equivalent to passwordSchema. */
    public static function rules(): array
    {
        return [
            'string', 'min:10', 'max:128',
            function (string $attribute, mixed $value, \Closure $fail) {
                if (in_array(strtolower((string) $value), self::COMMON, true)) {
                    $fail('This password is too common. Choose another.');
                }
                if (! preg_match('/[A-Za-z]/', (string) $value) || ! preg_match('/\d/', (string) $value)) {
                    $fail('Include at least one letter and one number.');
                }
            },
        ];
    }

    public static function messages(string $field = 'password'): array
    {
        return [
            "{$field}.min" => 'Use at least 10 characters.',
            "{$field}.max" => 'Use at most 128 characters.',
        ];
    }

    /** For code paths without a FormRequest. */
    public function assertStrong(string $password, string $field = 'password'): void
    {
        $v = validator([$field => $password], [$field => ['required', ...self::rules()]], self::messages($field));
        if ($v->fails()) {
            throw new ValidationException($v);
        }
    }

    public function assertNotBlank(string $password): void
    {
        if ($password === '') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Enter your password.', ['field' => 'password']);
        }
    }
}
