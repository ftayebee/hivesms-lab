<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Pre-rendered transactional email (EmailTemplates). Queued so slow mail providers never block an
 * HTTP request; retried 3 times with backoff.
 */
class TransactionalMail extends Mailable implements ShouldQueue
{
    use Queueable;
    use SerializesModels;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [30, 120, 600];

    public function __construct(
        public readonly string $mailSubject,
        public readonly string $htmlBody,
        public readonly string $plain,
        public readonly string $tag = 'email',
    ) {}

    /** @param array{subject: string, html: string, text: string, tag: string} $email */
    public static function fromTemplate(array $email): self
    {
        return new self($email['subject'], $email['html'], $email['text'], $email['tag']);
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->mailSubject, tags: [$this->tag]);
    }

    public function content(): Content
    {
        return new Content(htmlString: $this->htmlBody, text: 'mail.plain', with: ['plain' => $this->plain]);
    }
}
