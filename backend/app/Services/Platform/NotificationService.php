<?php

namespace App\Services\Platform;

use App\Models\Notification;
use App\Models\NotificationPreference;
use App\Models\OrganizationMember;
use App\Models\User;
use Closure;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * In-app + email notifications honouring user preferences (port of src/services/notify.ts).
 * Never throws: notifications must not break the operation that triggered them.
 */
class NotificationService
{
    /** type => [label, permission, emailByDefault] */
    public const TYPES = [
        'campaign.completed' => ['Campaign completed', 'campaigns:read', true],
        'campaign.failed' => ['Campaign failed', 'campaigns:read', true],
        'campaign.review' => ['Campaign review decisions', 'campaigns:read', true],
        'sender_id.status' => ['Sender ID status changes', 'sender_ids:read', true],
        'payment.succeeded' => ['Payment successful', 'billing:read', true],
        'payment.failed' => ['Payment failed', 'billing:read', true],
        'balance.low' => ['Low balance', 'billing:read', true],
        'api_key.created' => ['API key created or revoked', 'api_keys:read', true],
        'support.updated' => ['Support ticket updates', 'support:read', true],
        'team.changed' => ['Team membership changes', 'team:read', false],
        'campaign.lifecycle' => ['Campaign started, paused or resumed', 'campaigns:read', false],
        'campaign.partial' => ['Campaign finished with failed or unconfirmed messages', 'campaigns:read', true],
        'payment.topup' => ['Manual top-up request updates', 'billing:read', true],
    ];

    /**
     * Platform staff alerts: in-app rows with organizationId NULL for staff holding one of the roles,
     * emailed to SUPER_ADMIN by default. type => [label, roles, emailByDefault]
     */
    public const STAFF_TYPES = [
        'staff.payment_request' => ['New manual payment request', ['ADMIN', 'SUPER_ADMIN'], false],
        'staff.payment_suspicious' => ['Suspicious payment submission', ['SUPER_ADMIN'], true],
        'staff.campaign_risk' => ['Campaign held by a risk control', ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'], false],
        'staff.unconfirmed_messages' => ['Messages with an unconfirmed provider outcome', ['ADMIN', 'SUPER_ADMIN'], false],
    ];

    public function __construct(private readonly Mailer $mailer) {}

    /** Never throws. Called on state transitions that happen once, so retries never duplicate it. */
    public function notifyStaff(string $type, string $title, string $body, ?string $link = null): void
    {
        try {
            [, $roles, $emailDefault] = self::STAFF_TYPES[$type];
            $users = User::query()->whereIn('platformRole', $roles)->where('status', 'ACTIVE')->get(['id', 'email', 'name', 'platformRole']);
            if ($users->isEmpty()) {
                return;
            }
            $now = now()->format('Y-m-d H:i:s.v');
            Notification::query()->insert($users->map(fn (User $u) => [
                'id' => (string) Str::uuid(), 'organizationId' => null, 'userId' => $u->id, 'type' => $type,
                'title' => mb_substr($title, 0, 255), 'body' => $body, 'link' => $link, 'createdAt' => $now,
            ])->all());
            if ($emailDefault) {
                foreach ($users->filter(fn (User $u) => ($u->platformRole?->value ?? $u->platformRole) === 'SUPER_ADMIN') as $u) {
                    $this->mailer->send($u->email, [
                        'subject' => $title, 'tag' => $type,
                        'text' => "{$body}\n\n".($link ? rtrim((string) config('smsflow.frontend_url'), '/').$link : ''),
                        'html' => '<p>'.e($body).'</p>'.($link ? '<p><a href="'.e(rtrim((string) config('smsflow.frontend_url'), '/').$link).'">Open</a></p>' : ''),
                    ]);
                }
            }
        } catch (Throwable $e) {
            Log::error('staff notification failed', ['type' => $type, 'error' => $e->getMessage()]);
        }
    }

    /**
     * @param  list<string>|null  $userIds  explicit recipients; otherwise active members holding the type's permission
     * @param  (Closure(string $name): array{subject: string, html: string, text: string, tag: string})|null  $email
     */
    public function notify(string $organizationId, string $type, string $title, string $body, ?string $link = null, ?array $userIds = null, ?Closure $email = null): void
    {
        try {
            [, $permission, $emailDefault] = self::TYPES[$type];
            if ($userIds) {
                $users = User::query()->whereIn('id', $userIds)->where('status', 'ACTIVE')->get(['id', 'email', 'name']);
            } else {
                $users = OrganizationMember::query()
                    ->where('organizationId', $organizationId)
                    ->where('status', 'ACTIVE')
                    ->whereHas('role.grantedPermissions', fn ($q) => $q->where('key', $permission))
                    ->with('user:id,email,name,status')
                    ->get()
                    ->pluck('user')
                    ->filter(fn ($u) => $u && $u->status->value === 'ACTIVE')
                    ->values();
            }
            if ($users->isEmpty()) {
                return;
            }
            $prefs = NotificationPreference::query()->whereIn('userId', $users->pluck('id'))->where('type', $type)->get()->keyBy('userId');

            $now = now()->format('Y-m-d H:i:s.v');
            $rows = [];
            foreach ($users as $u) {
                if ($prefs->get($u->id)?->inApp ?? true) {
                    $rows[] = [
                        'id' => (string) Str::uuid(),
                        'organizationId' => $organizationId,
                        'userId' => $u->id,
                        'type' => $type,
                        'title' => mb_substr($title, 0, 255),
                        'body' => $body,
                        'link' => $link,
                        'createdAt' => $now,
                    ];
                }
            }
            if ($rows) {
                Notification::query()->insert($rows);
            }
            if ($email) {
                foreach ($users as $u) {
                    if ($prefs->get($u->id)?->email ?? $emailDefault) {
                        $this->mailer->send($u->email, $email($u->name));
                    }
                }
            }
        } catch (Throwable $e) {
            Log::error('notification failed', ['type' => $type, 'error' => $e->getMessage()]);
        }
    }
}
