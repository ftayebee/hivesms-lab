<?php

namespace App\Mail;

/**
 * Transactional email templates (port of src/services/email/templates.ts). Every dynamic value
 * is HTML-escaped. Each method returns [subject, html, text, tag].
 *
 * @phpstan-type Email array{subject: string, html: string, text: string, tag: string}
 */
final class EmailTemplates
{
    private static function esc(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    private static function url(string $path): string
    {
        return config('smsflow.frontend_url').$path;
    }

    private static function site(): string
    {
        return (string) config('smsflow.site.name');
    }

    /**
     * @param  list<string>  $paragraphs
     * @param  list<array{0: string, 1: string}>  $rows
     * @return array{html: string, text: string}
     */
    private static function layout(string $preheader, string $heading, array $paragraphs, ?array $cta = null, ?string $footnote = null, array $rows = []): array
    {
        $e = fn (string $s) => self::esc($s);
        $rowsHtml = $rows ? '<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">'.implode('', array_map(
            fn ($r) => '<tr><td style="padding:8px 0;color:#52607A;border-bottom:1px solid #E2E7EF">'.$e($r[0]).'</td><td style="padding:8px 0;text-align:right;color:#0E1A36;border-bottom:1px solid #E2E7EF;font-weight:600">'.$e($r[1]).'</td></tr>',
            $rows,
        )).'</table>' : '';
        $ctaHtml = $cta ? '<p style="margin:24px 0"><a href="'.$e($cta['url']).'" style="background:#1E3FA8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">'.$e($cta['label']).'</a></p><p style="font-size:12px;color:#52607A">If the button does not work, copy this link:<br><span style="word-break:break-all">'.$e($cta['url']).'</span></p>' : '';
        $paras = implode('', array_map(fn ($p) => '<p style="font-size:15px;line-height:1.6;margin:0 0 12px">'.$e($p).'</p>', $paragraphs));
        $foot = $footnote ? '<p style="font-size:13px;color:#52607A;margin-top:24px">'.$e($footnote).'</p>' : '';
        $site = self::site();
        $html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'.$e($heading).'</title></head>'
            .'<body style="margin:0;background:#F6F8FB;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0E1A36">'
            .'<span style="display:none;max-height:0;overflow:hidden">'.$e($preheader).'</span>'
            .'<table role="presentation" width="100%" style="padding:32px 16px"><tr><td align="center">'
            .'<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #E2E7EF;border-radius:12px;padding:32px"><tr><td>'
            .'<p style="font-weight:700;font-size:16px;color:#1E3FA8;margin:0 0 24px">'.$e($site).'</p>'
            .'<h1 style="font-size:20px;margin:0 0 16px">'.$e($heading).'</h1>'.$paras.$rowsHtml.$ctaHtml.$foot
            .'</td></tr></table>'
            .'<p style="font-size:12px;color:#52607A;margin-top:16px">'.$e((string) config('smsflow.site.legal_name')).' · '.$e((string) config('smsflow.site.address')).'<br>You received this email because of activity on your '.$e($site).' account.</p>'
            .'</td></tr></table></body></html>';
        $text = implode("\n", array_merge(
            [$heading, ''],
            $paragraphs,
            array_map(fn ($r) => "{$r[0]}: {$r[1]}", $rows),
            $cta ? ['', "{$cta['label']}: {$cta['url']}"] : [],
            $footnote ? ['', $footnote] : [],
            ['', $site],
        ));

        return ['html' => $html, 'text' => $text];
    }

    private static function make(string $subject, string $tag, array $body): array
    {
        return ['subject' => $subject, 'html' => $body['html'], 'text' => $body['text'], 'tag' => $tag];
    }

    public static function welcome(string $name): array
    {
        return self::make('Welcome to '.self::site(), 'welcome', self::layout('Your account is ready.', "Welcome, {$name}", [
            'Your '.self::site().' account is ready. Next steps: verify your email, add balance, and request a sender ID if you need a branded sender name.',
        ], ['label' => 'Open dashboard', 'url' => self::url('/dashboard')]));
    }

    public static function verifyEmail(string $name, string $link): array
    {
        return self::make('Verify your email address', 'verify-email', self::layout('Confirm your email address.', 'Confirm your email address', [
            "Hi {$name}, confirm this email address to start sending messages. The link expires in 24 hours.",
        ], ['label' => 'Verify email', 'url' => $link], 'If you did not create an account, you can ignore this email.'));
    }

    public static function passwordReset(string $name, string $link): array
    {
        return self::make('Reset your password', 'password-reset', self::layout('Reset your password.', 'Reset your password', [
            "Hi {$name}, we received a request to reset your password. The link expires in 1 hour and can be used once.",
        ], ['label' => 'Choose a new password', 'url' => $link], 'If you did not request this, you can ignore this email. Your password will not change.'));
    }

    public static function passwordChanged(string $name): array
    {
        return self::make('Your password was changed', 'password-changed', self::layout('Your password was changed.', 'Your password was changed', [
            "Hi {$name}, the password for your account was just changed and other sessions were signed out.",
        ], null, 'If this was not you, reset your password immediately and contact '.config('smsflow.site.support_email').'.'));
    }

    public static function invitation(string $orgName, string $inviterName, string $roleName, string $link): array
    {
        return self::make("You're invited to {$orgName}", 'invitation', self::layout("{$inviterName} invited you to {$orgName}.", "Join {$orgName} on ".self::site(), [
            "{$inviterName} invited you to join {$orgName} as {$roleName}. The invitation expires in 7 days.",
        ], ['label' => 'Accept invitation', 'url' => $link]));
    }

    /** @param array{invoiceNumber: string, subtotal: string, vat: string, total: string, credit: string, method: string} $d */
    public static function paymentReceipt(array $d): array
    {
        return self::make("Payment receipt {$d['invoiceNumber']}", 'payment-receipt', self::layout("Payment received: {$d['total']}.", 'Payment received', [
            'Thank you. Your payment was confirmed and the balance has been added to your wallet.',
        ], ['label' => 'View invoice', 'url' => self::url('/dashboard/wallet')], null, [
            ['Invoice', $d['invoiceNumber']], ['Subtotal', $d['subtotal']], ['VAT', $d['vat']], ['Total paid', $d['total']],
            ['Added to wallet', $d['credit']], ['Payment method', $d['method']],
        ]));
    }

    public static function lowBalance(string $balance, string $threshold): array
    {
        return self::make('Low balance alert', 'low-balance', self::layout("Balance is {$balance}.", 'Your balance is running low', [
            "Your wallet balance is {$balance}, below your alert threshold of {$threshold}. Messages will not send once the balance runs out.",
        ], ['label' => 'Add balance', 'url' => self::url('/dashboard/wallet')], 'You can change the alert threshold in Wallet settings.'));
    }

    /** @param array{name: string, recipients: int, delivered: int, failed: int, cost: string, campaignId: string} $d */
    public static function campaignCompleted(array $d): array
    {
        return self::make("Campaign completed: {$d['name']}", 'campaign-completed', self::layout("{$d['name']} finished sending.", "Campaign completed: {$d['name']}", [
            'Your campaign has finished sending. Delivery reports may continue to arrive for a while.',
        ], ['label' => 'View report', 'url' => self::url("/dashboard/campaigns/{$d['campaignId']}")], null, [
            ['Recipients', (string) $d['recipients']], ['Delivered', (string) $d['delivered']], ['Failed', (string) $d['failed']], ['Cost', $d['cost']],
        ]));
    }

    public static function senderIdStatus(string $value, string $status, ?string $reason): array
    {
        $heading = match ($status) {
            'APPROVED' => "Sender ID {$value} approved",
            'REJECTED' => "Sender ID {$value} was not approved",
            default => "Sender ID {$value} suspended",
        };

        return self::make($heading, 'sender-id-status', self::layout($heading, $heading, [
            $status === 'APPROVED'
                ? 'You can now select this sender ID when sending messages.'
                : 'Reason: '.($reason ?: 'No reason was provided.').' You can submit a new request with updated documents.',
        ], ['label' => 'View sender IDs', 'url' => self::url('/dashboard/sender-ids')]));
    }

    public static function supportTicketUpdate(int $number, string $subject, string $status, string $excerpt, string $ticketId): array
    {
        return self::make("[#{$number}] {$subject}", 'support-update', self::layout("Update on ticket #{$number}", "Ticket #{$number}: {$subject}", [
            "Status: {$status}.", $excerpt,
        ], ['label' => 'View ticket', 'url' => self::url("/dashboard/support/{$ticketId}")]));
    }
}
