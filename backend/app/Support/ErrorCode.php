<?php

namespace App\Support;

/**
 * Application error codes and their HTTP status. Part of the public API contract (same codes
 * as the Next.js implementation in src/lib/errors.ts): only add codes, never rename them.
 */
enum ErrorCode: string
{
    case INVALID_REQUEST = 'INVALID_REQUEST';
    case VALIDATION_ERROR = 'VALIDATION_ERROR';
    case UNAUTHORIZED = 'UNAUTHORIZED';
    case INVALID_API_KEY = 'INVALID_API_KEY';
    case FORBIDDEN = 'FORBIDDEN';
    case INSUFFICIENT_SCOPE = 'INSUFFICIENT_SCOPE';
    case ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED';
    case EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';
    case NOT_FOUND = 'NOT_FOUND';
    case CONFLICT = 'CONFLICT';
    case IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT';
    case RATE_LIMITED = 'RATE_LIMITED';
    case INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE';
    case INVALID_RECIPIENT = 'INVALID_RECIPIENT';
    case SENDER_ID_NOT_APPROVED = 'SENDER_ID_NOT_APPROVED';
    case CONTENT_BLOCKED = 'CONTENT_BLOCKED';
    case MESSAGE_TOO_LONG = 'MESSAGE_TOO_LONG';
    case RECIPIENT_SUPPRESSED = 'RECIPIENT_SUPPRESSED';
    case QUIET_HOURS = 'QUIET_HOURS';
    case DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED';
    case MONTHLY_LIMIT_EXCEEDED = 'MONTHLY_LIMIT_EXCEEDED';
    case PAYMENT_FAILED = 'PAYMENT_FAILED';
    case PROVIDER_ERROR = 'PROVIDER_ERROR';
    case PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED';
    case FEATURE_DISABLED = 'FEATURE_DISABLED';
    case INTERNAL_ERROR = 'INTERNAL_ERROR';

    public function status(): int
    {
        return match ($this) {
            self::INVALID_REQUEST => 400,
            self::VALIDATION_ERROR, self::INVALID_RECIPIENT, self::SENDER_ID_NOT_APPROVED, self::CONTENT_BLOCKED,
            self::MESSAGE_TOO_LONG, self::RECIPIENT_SUPPRESSED, self::QUIET_HOURS => 422,
            self::UNAUTHORIZED, self::INVALID_API_KEY => 401,
            self::FORBIDDEN, self::INSUFFICIENT_SCOPE, self::ACCOUNT_SUSPENDED, self::EMAIL_NOT_VERIFIED,
            self::FEATURE_DISABLED => 403,
            self::NOT_FOUND => 404,
            self::CONFLICT, self::IDEMPOTENCY_CONFLICT => 409,
            self::RATE_LIMITED, self::DAILY_LIMIT_EXCEEDED, self::MONTHLY_LIMIT_EXCEEDED => 429,
            self::INSUFFICIENT_BALANCE, self::PAYMENT_FAILED => 402,
            self::PROVIDER_ERROR => 502,
            self::PROVIDER_NOT_CONFIGURED => 503,
            self::INTERNAL_ERROR => 500,
        };
    }
}
