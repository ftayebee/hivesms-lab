<?php

namespace App\Services\Platform;

use App\Exceptions\AppException;
use App\Models\AbuseReport;
use App\Models\ContactRequest;
use App\Models\SenderId;
use App\Support\ErrorCode;
use Carbon\CarbonImmutable;

/** Public website forms: contact/sales requests and abuse reports (port of features/public/actions.ts). */
class PublicFormService
{
    public function __construct(private readonly RateLimiter $rateLimiter, private readonly Mailer $mailer, private readonly SettingsService $settings) {}

    private function guard(string $prefix, ?string $ip): void
    {
        if (! $this->rateLimiter->hit("{$prefix}:".($ip ?? 'unknown'), RateLimiter::rule('public_form_per_ip'))['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many submissions. Please try again in a few minutes.');
        }
    }

    public function contactRequest(array $input, ?string $ip): void
    {
        $this->guard('contact', $ip);
        ContactRequest::query()->forceCreate(array_intersect_key($input, array_flip(['name', 'company', 'email', 'phone', 'subject', 'message'])) + ['ipAddress' => $ip]);
        $e = fn (?string $s) => htmlspecialchars($s ?? '-', ENT_QUOTES, 'UTF-8');
        $to = (string) (($this->settings->siteContent()['contact']['salesEmail'] ?? '') ?: config('smsflow.site.sales_email'));
        $this->mailer->send($to, [
            'subject' => "[Website] {$input['subject']}",
            'text' => "From: {$input['name']} <{$input['email']}>\nCompany: ".($input['company'] ?? '-')."\nPhone: ".($input['phone'] ?? '-')."\n\n{$input['message']}",
            'html' => "<p>From: {$e($input['name'])} &lt;{$e($input['email'])}&gt;<br>Company: {$e($input['company'] ?? null)}<br>Phone: {$e($input['phone'] ?? null)}</p><p>".nl2br($e($input['message'])).'</p>',
            'tag' => 'contact-request',
        ]);
    }

    public function abuseReport(array $input, ?string $ip): void
    {
        $this->guard('abuse', $ip);
        // Case-insensitive match (sender_ids.value uses utf8mb4_unicode_ci).
        $orgId = SenderId::query()->where('value', $input['senderValue'])->value('organizationId');
        $receivedAt = null;
        if (! empty($input['receivedAt'])) {
            try {
                $receivedAt = CarbonImmutable::parse($input['receivedAt'])->utc();
            } catch (\Throwable) {
            }
        }
        AbuseReport::query()->forceCreate([
            'reporterName' => $input['reporterName'] ?? null, 'reporterEmail' => $input['reporterEmail'] ?? null, 'reporterPhone' => $input['reporterPhone'] ?? null,
            'senderValue' => $input['senderValue'], 'messageContent' => $input['messageContent'], 'receivedAt' => $receivedAt,
            'description' => $input['description'] ?? null, 'organizationId' => $orgId, 'ipAddress' => $ip,
        ]);
    }
}
