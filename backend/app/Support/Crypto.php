<?php

namespace App\Support;

use RuntimeException;

/**
 * Port of src/lib/crypto.ts. Formats are byte-compatible with the Node app so tokens, API key
 * hashes, OTP hashes and encrypted settings written by either side are readable by the other.
 */
final class Crypto
{
    /** URL-safe random token (base64url, no padding), default 32 bytes of entropy. */
    public static function randomToken(int $bytes = 32): string
    {
        return self::base64UrlEncode(random_bytes($bytes));
    }

    /** Random lowercase alphanumeric string. */
    public static function randomAlphanumeric(int $length): string
    {
        $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= $alphabet[random_int(0, 35)];
        }

        return $out;
    }

    public static function randomNumericCode(int $length = 6): string
    {
        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= (string) random_int(0, 9);
        }

        return $out;
    }

    public static function sha256(string $value): string
    {
        return hash('sha256', $value);
    }

    public static function hmacSha256(string $key, string $value): string
    {
        return hash_hmac('sha256', $value, $key);
    }

    /** Constant-time comparison. */
    public static function safeEqual(string $a, string $b): bool
    {
        return hash_equals($a, $b);
    }

    public static function base64UrlEncode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function base64UrlDecode(string $value): string
    {
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if ($decoded === false) {
            throw new RuntimeException('Invalid base64url value');
        }

        return $decoded;
    }

    /** 32-byte key: base64 that decodes to 32 bytes, otherwise sha256 of the raw string (as in Node). */
    private static function encryptionKey(): string
    {
        $raw = (string) config('smsflow.settings_encryption_key');
        if ($raw === '') {
            throw new RuntimeException('SETTINGS_ENCRYPTION_KEY is not set');
        }
        $decoded = base64_decode($raw, true);

        return ($decoded !== false && strlen($decoded) === 32) ? $decoded : hash('sha256', $raw, true);
    }

    /** AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext> (base64url parts). */
    public static function encryptSecret(string $plaintext): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', self::encryptionKey(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($ciphertext === false) {
            throw new RuntimeException('Encryption failed');
        }

        return implode('.', ['v1', self::base64UrlEncode($iv), self::base64UrlEncode($tag), self::base64UrlEncode($ciphertext)]);
    }

    public static function decryptSecret(string $payload): string
    {
        $parts = explode('.', $payload);
        if (count($parts) !== 4 || $parts[0] !== 'v1' || $parts[1] === '' || $parts[2] === '' || $parts[3] === '') {
            throw new RuntimeException('Unsupported secret format');
        }
        $plain = openssl_decrypt(
            self::base64UrlDecode($parts[3]),
            'aes-256-gcm',
            self::encryptionKey(),
            OPENSSL_RAW_DATA,
            self::base64UrlDecode($parts[1]),
            self::base64UrlDecode($parts[2]),
        );
        if ($plain === false) {
            throw new RuntimeException('Decryption failed');
        }

        return $plain;
    }
}
