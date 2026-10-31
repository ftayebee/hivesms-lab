<?php

namespace App\Services\Platform;

use App\Mail\TransactionalMail;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Sends (queues) a transactional email without ever throwing: email problems are logged and must
 * not break the user flow that triggered them (same contract as sendEmail in services/email).
 */
class Mailer
{
    /** @param array{subject: string, html: string, text: string, tag: string} $email */
    public function send(string $to, array $email): void
    {
        try {
            Mail::to($to)->queue(TransactionalMail::fromTemplate($email));
        } catch (Throwable $e) {
            Log::error('email send failed', ['to' => self::maskEmail($to), 'tag' => $email['tag'], 'error' => $e->getMessage()]);
        }
    }

    public static function maskEmail(string $email): string
    {
        $parts = explode('@', $email, 2);

        return count($parts) === 2 ? mb_substr($parts[0], 0, 2).'***@'.$parts[1] : '***';
    }
}
