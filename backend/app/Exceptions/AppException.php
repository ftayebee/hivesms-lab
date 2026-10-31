<?php

namespace App\Exceptions;

use App\Support\ErrorCode;
use RuntimeException;

/**
 * Expected business error with a stable code (same role as AppError in the Next.js app).
 * `expose: false` replaces the message with a generic one in responses.
 */
class AppException extends RuntimeException
{
    /** @param array<string, mixed>|null $details */
    public function __construct(
        public readonly ErrorCode $errorCode,
        string $message,
        public readonly ?array $details = null,
        public readonly bool $expose = true,
    ) {
        parent::__construct($message);
    }

    public function status(): int
    {
        return $this->errorCode->status();
    }
}
