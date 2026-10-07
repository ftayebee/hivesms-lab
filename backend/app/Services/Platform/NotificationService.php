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
    ];

    public function __construct(private readonly Mailer $mailer) {}

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
