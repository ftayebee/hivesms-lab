<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Auth\Permissions;
use App\Models\AbuseReport;
use App\Models\AuditLog;
use App\Models\Campaign;
use App\Models\Payment;
use App\Models\SenderId;
use App\Models\SupportTicket;
use App\Support\DateRange;
use App\Support\Dhaka;
use Illuminate\Support\Facades\DB;

/**
 * Platform-wide dashboard: real aggregates only. Finance figures are included only for roles with
 * `admin:finance:read`, recent privileged actions only with `admin:audit:read`.
 * "Pending" customers = organizations where no member has verified an e-mail address yet.
 * There is no recurring-subscription model (prepaid wallet + plan rates): plan distribution is
 * reported, subscriptions are reported as not supported rather than invented.
 */
class PlatformDashboardService
{
    /** Audit actions that count as privileged (staff, money, pricing, account status). */
    public const PRIVILEGED_PREFIXES = ['admin.user.', 'admin.staff.', 'admin.bootstrap', 'admin.wallet.', 'admin.organization.', 'admin.reauth.', 'payment.refund', 'payment.completed', 'pricing.', 'admin.settings.'];

    public function __construct(private readonly FinanceService $finance) {}

    private static function ts(\DateTimeInterface $d): string
    {
        return $d->format('Y-m-d H:i:s.v');
    }

    public function dashboard(AdminContext $admin, DateRange $range): array
    {
        $orgs = DB::selectOne("SELECT COUNT(*) AS total,
                COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) AS active,
                COUNT(CASE WHEN status = 'SUSPENDED' THEN 1 END) AS suspended,
                COUNT(CASE WHEN requireCampaignReview = 1 THEN 1 END) AS underReview,
                COUNT(CASE WHEN NOT EXISTS (SELECT 1 FROM organization_members om JOIN users u ON u.id = om.userId
                    WHERE om.organizationId = organizations.id AND u.emailVerifiedAt IS NOT NULL) THEN 1 END) AS pending,
                COUNT(CASE WHEN createdAt >= ? AND createdAt < ? THEN 1 END) AS newInRange
            FROM organizations WHERE deletedAt IS NULL", [self::ts($range->from), self::ts($range->to)]);
        $users = DB::selectOne("SELECT COUNT(*) AS total, COUNT(CASE WHEN platformRole = 'USER' THEN 1 END) AS customers,
                COUNT(CASE WHEN platformRole <> 'USER' AND status = 'ACTIVE' THEN 1 END) AS staff FROM users WHERE deletedAt IS NULL");
        $plans = DB::select('SELECT p.id, COALESCE(p.name, ?) AS name, p.active, COUNT(o.id) AS organizations
            FROM organizations o LEFT JOIN pricing_plans p ON p.id = o.pricingPlanId WHERE o.deletedAt IS NULL
            GROUP BY p.id, p.name, p.active ORDER BY organizations DESC', ['Default plan']);

        $sms = fn (\DateTimeInterface $from, \DateTimeInterface $to) => (array) DB::selectOne("SELECT COUNT(*) AS total, COALESCE(SUM(segments), 0) AS segments,
                COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered,
                COUNT(CASE WHEN status IN ('FAILED','REJECTED','EXPIRED','CANCELLED') THEN 1 END) AS failed,
                COUNT(CASE WHEN status IN ('QUEUED','SUBMITTED') THEN 1 END) AS pending
            FROM messages WHERE createdAt >= ? AND createdAt < ?", [self::ts($from), self::ts($to)]);
        $now = Dhaka::now();

        $out = [
            'range' => $range->toArray(),
            'customers' => array_map('intval', (array) $orgs) + ['users' => (int) $users->total, 'customerUsers' => (int) $users->customers, 'activeStaff' => (int) $users->staff],
            'plans' => array_map(fn ($p) => ['id' => $p->id, 'name' => $p->name, 'active' => $p->active === null ? true : (bool) $p->active, 'organizations' => (int) $p->organizations], $plans),
            'subscriptions' => ['supported' => false, 'note' => 'Prepaid wallet with per-SMS plan rates; no recurring subscriptions exist.'],
            'sms' => [
                'today' => array_map('intval', $sms(Dhaka::startOfDay(), $now->addSecond())),
                'month' => array_map('intval', $sms(Dhaka::startOfMonth(), $now->addSecond())),
                'range' => array_map('intval', $sms($range->from, $range->to)),
            ],
            'queues' => [
                'manualPayments' => Payment::query()->where('status', 'AWAITING_VERIFICATION')->count(),
                'senderIds' => SenderId::query()->where('status', 'PENDING')->count(),
                'campaignReviews' => Campaign::query()->where('status', 'PENDING_REVIEW')->count(),
                'openTickets' => SupportTicket::query()->whereIn('status', ['OPEN', 'IN_PROGRESS'])->count(),
                'urgentTickets' => SupportTicket::query()->whereIn('status', ['OPEN', 'IN_PROGRESS'])->whereIn('priority', ['URGENT', 'HIGH'])->count(),
                'newAbuseReports' => AbuseReport::query()->where('status', 'NEW')->count(),
            ],
            'finance' => null,
            'recentPrivilegedActions' => null,
        ];
        if (Permissions::platformCan($admin->role, 'admin:finance:read')) {
            $out['finance'] = $this->finance->summary($range);
        }
        if (Permissions::platformCan($admin->role, 'admin:audit:read')) {
            $out['recentPrivilegedActions'] = AuditLog::query()
                ->where(fn ($q) => collect(self::PRIVILEGED_PREFIXES)->each(fn ($p) => $q->orWhere('action', 'like', addcslashes($p, '%_\\').'%')))
                ->with(['actor:id,name', 'organization' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
                ->orderByDesc('createdAt')->limit(10)->get();
        }

        return $out;
    }
}
