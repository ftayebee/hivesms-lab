<?php

namespace App\Support;

use App\Exceptions\AppException;

/**
 * SSRF protection for customer-supplied URLs (webhooks) — port of src/lib/safe-url.ts. HTTPS
 * only (plain http://localhost allowed outside production), no credentials in the URL, and the
 * host must not be or resolve to a private, loopback, link-local or otherwise internal address.
 */
final class SafeUrl
{
    private static function devAllowsLocal(): bool
    {
        return ! app()->isProduction();
    }

    public static function isPrivateAddress(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            [$a, $b] = array_map('intval', explode('.', $ip));

            return $a === 10 || $a === 127 || $a === 0 || ($a === 169 && $b === 254) || ($a === 172 && $b >= 16 && $b <= 31)
                || ($a === 192 && $b === 168) || ($a === 100 && $b >= 64 && $b <= 127) || $a >= 224;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            $v = strtolower($ip);
            if ($v === '::1' || $v === '::' || str_starts_with($v, 'fe80') || str_starts_with($v, 'fc') || str_starts_with($v, 'fd')) {
                return true;
            }
            if (preg_match('/^::ffff:(\d+\.\d+\.\d+\.\d+)$/', $v, $m)) {
                return self::isPrivateAddress($m[1]);
            }

            return false;
        }

        return true; // not an IP at all: treat as unsafe
    }

    /** Static checks (no DNS), for validation when the URL is saved. Returns the parsed parts. */
    public static function assertAcceptable(string $raw, string $field = 'url'): array
    {
        $parts = parse_url($raw);
        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Enter a valid URL.', ['field' => $field]);
        }
        $host = trim($parts['host'], '[]');
        $local = $host === 'localhost' || $host === '127.0.0.1';
        $scheme = strtolower($parts['scheme']);
        if ($scheme !== 'https' && ! (self::devAllowsLocal() && $local && $scheme === 'http')) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Webhook URLs must use HTTPS.', ['field' => $field]);
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Do not include credentials in the URL.', ['field' => $field]);
        }
        if (! (self::devAllowsLocal() && $local) && filter_var($host, FILTER_VALIDATE_IP) && self::isPrivateAddress($host)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Private and internal addresses are not allowed.', ['field' => $field]);
        }

        return $parts + ['host_clean' => $host];
    }

    /** Full check including DNS resolution; call right before making the request. */
    public static function assertPublicDestination(string $raw): void
    {
        $parts = self::assertAcceptable($raw);
        $host = $parts['host_clean'];
        if (self::devAllowsLocal() && ($host === 'localhost' || $host === '127.0.0.1')) {
            return;
        }
        $addresses = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : self::resolve($host);
        if (! $addresses) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The webhook host could not be resolved.', ['field' => 'url']);
        }
        foreach ($addresses as $ip) {
            if (self::isPrivateAddress($ip)) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'The webhook host resolves to a private or internal address.', ['field' => 'url']);
            }
        }
    }

    /** @return list<string> */
    private static function resolve(string $host): array
    {
        $out = [];
        foreach (@dns_get_record($host, DNS_A | DNS_AAAA) ?: [] as $r) {
            if (isset($r['ip'])) {
                $out[] = $r['ip'];
            }
            if (isset($r['ipv6'])) {
                $out[] = $r['ipv6'];
            }
        }
        if (! $out) {
            $v4 = @gethostbynamel($host);
            $out = $v4 ?: [];
        }

        return $out;
    }
}
