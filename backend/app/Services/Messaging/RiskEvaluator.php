<?php

namespace App\Services\Messaging;

/**
 * Abuse-risk heuristics (port of services/risk). Conservative: flags content for human review,
 * never silently blocks. Returns ['action' => 'allow'|'review', 'reasons' => [...]].
 */
class RiskEvaluator
{
    private const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc'];

    /** @return array{action: 'allow'|'review', reasons: list<string>} */
    public function evaluate(string $message, string $smsType, int $recipientCount, float $organizationAgeDays): array
    {
        $reasons = [];
        $lower = mb_strtolower($message);
        foreach (self::SHORTENERS as $d) {
            if (str_contains($lower, $d)) {
                $reasons[] = 'Contains a URL shortener';
                break;
            }
        }
        if (preg_match('/(https?:\/\/|www\.)[^\s]+/i', $message) && preg_match('/(verify|confirm|update|unlock).{0,40}(account|pin|password|otp|card)/i', $message)) {
            $reasons[] = 'Asks the recipient to verify account details and contains a link';
        }
        if ($organizationAgeDays < 3 && $recipientCount > 500) {
            $reasons[] = 'Large send from a new account';
        }
        if ($smsType === 'TRANSACTIONAL' && $recipientCount > 2000) {
            $reasons[] = 'Very large transactional batch (transactional traffic is usually one-to-one)';
        }

        return ['action' => $reasons ? 'review' : 'allow', 'reasons' => $reasons];
    }
}
