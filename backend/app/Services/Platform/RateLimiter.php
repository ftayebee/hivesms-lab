<?php

namespace App\Services\Platform;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Fixed-window rate limiter on the existing rate_limit_buckets table (port of
 * src/lib/rate-limit.ts): atomic INSERT … ON DUPLICATE KEY UPDATE, so limits hold across app
 * instances without Redis, and buckets are shared with the Node app during the transition.
 * Fails open (loudly) on database errors so a hiccup does not lock everyone out of login;
 * balances and sending limits are enforced separately.
 */
class RateLimiter
{
    /**
     * @param  array{limit: int, window: int}  $rule
     * @return array{allowed: bool, limit: int, remaining: int, resetAt: int}
     */
    public function hit(string $key, array $rule): array
    {
        $key = mb_substr($key, 0, 191);
        $nowMs = (int) floor(microtime(true) * 1000);
        $windowMs = $rule['window'] * 1000;
        $startMs = intdiv($nowMs, $windowMs) * $windowMs;
        $windowStart = CarbonImmutable::createFromTimestampMs($startMs, 'UTC');
        $expiresAt = $windowStart->addSeconds($rule['window']);
        $resetAt = (int) ceil(($startMs + $windowMs) / 1000);

        try {
            $count = DB::transaction(function () use ($key, $windowStart, $expiresAt) {
                $ws = $windowStart->format('Y-m-d H:i:s.v');
                DB::statement(
                    'INSERT INTO rate_limit_buckets (`key`, windowStart, `count`, expiresAt) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE `count` = `count` + 1',
                    [$key, $ws, $expiresAt->format('Y-m-d H:i:s.v')],
                );

                return (int) DB::scalar('SELECT `count` FROM rate_limit_buckets WHERE `key` = ? AND windowStart = ?', [$key, $ws]);
            });
        } catch (Throwable $e) {
            Log::error('rate limiter failure', ['key' => $key, 'error' => $e->getMessage()]);

            return ['allowed' => true, 'limit' => $rule['limit'], 'remaining' => $rule['limit'], 'resetAt' => $resetAt];
        }

        return [
            'allowed' => $count <= $rule['limit'],
            'limit' => $rule['limit'],
            'remaining' => max(0, $rule['limit'] - $count),
            'resetAt' => $resetAt,
        ];
    }

    /** @return array{limit: int, window: int} */
    public static function rule(string $name): array
    {
        $rule = config("smsflow.rate_limits.{$name}");
        if (! is_array($rule)) {
            throw new \InvalidArgumentException("Unknown rate limit rule {$name}");
        }

        return $rule;
    }

    /** @param array{allowed: bool, limit: int, remaining: int, resetAt: int} $r */
    public static function headers(array $r): array
    {
        $h = [
            'X-RateLimit-Limit' => (string) $r['limit'],
            'X-RateLimit-Remaining' => (string) $r['remaining'],
            'X-RateLimit-Reset' => (string) $r['resetAt'],
        ];
        if (! $r['allowed']) {
            $h['Retry-After'] = (string) max(1, $r['resetAt'] - time());
        }

        return $h;
    }

    public function purgeExpired(): int
    {
        return DB::table('rate_limit_buckets')->where('expiresAt', '<', now()->format('Y-m-d H:i:s.v'))->delete();
    }
}
