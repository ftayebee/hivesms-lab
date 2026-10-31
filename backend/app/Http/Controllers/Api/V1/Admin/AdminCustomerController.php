<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Admin\OrgControlsRequest;
use App\Http\Resources\ApiKeyResource;
use App\Http\Resources\AuditLogResource;
use App\Http\Resources\CampaignResource;
use App\Http\Resources\OrganizationResource;
use App\Http\Resources\PaymentResource;
use App\Http\Resources\SenderIdResource;
use App\Http\Resources\TeamMemberResource;
use App\Http\Resources\TransactionResource;
use App\Models\Organization;
use App\Models\Wallet;
use App\Services\Admin\AdminService;
use App\Support\Dhaka;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Customer (organization) management for platform staff. */
class AdminCustomerController extends ApiController
{
    public function __construct(private readonly AdminService $admin) {}

    /**
     * GET /admin/customers?q=&status=&planId=&review=1&from=&to=&sort=newest|balance&page= — existing snake_case
     * contract. q: organization name or ID, member e-mail, name or phone. from/to: registration date (Dhaka days).
     */
    public function index(Request $request): JsonResponse
    {
        $q = $request->validate([
            'q' => ['nullable', 'string', 'max:100'], 'status' => ['nullable', 'in:ACTIVE,SUSPENDED'], 'sort' => ['nullable', 'in:newest,balance'],
            'planId' => ['nullable', 'regex:/^(none|[0-9a-fA-F-]{36})$/'], 'review' => ['nullable', 'boolean'],
            'from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d'],
        ]);
        $from = isset($q['from']) ? Dhaka::parseDate($q['from']) : null;
        $to = isset($q['to']) ? Dhaka::parseDate($q['to'])?->addDay() : null;
        $page = $this->admin->organizations([
            'q' => $q['q'] ?? null, 'status' => $q['status'] ?? null, 'planId' => $q['planId'] ?? null, 'review' => (bool) ($q['review'] ?? false),
            'from' => $from?->format('Y-m-d H:i:s.v'), 'to' => $to?->format('Y-m-d H:i:s.v'),
        ], $this->page($request), $q['sort'] ?? 'newest');

        return $this->ok($page->getCollection()->map(fn (Organization $o) => [
            'id' => $o->id,
            'name' => $o->name,
            'status' => $o->status->value,
            'plan' => $o->pricingPlan?->name,
            'plan_id' => $o->pricingPlanId,
            'review_required' => (bool) $o->requireCampaignReview,
            'balance' => Money::round($o->wallet ? (string) $o->wallet->balance : '0', 2),
            'members' => (int) $o->members_count,
            'messages' => (int) $o->messages_count,
            'daily_send_limit' => $o->dailySendLimit,
            'created_at' => Dhaka::iso($o->createdAt),
        ])->values(), 200, ['total' => $page->total(), 'page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'totalPages' => $page->lastPage()]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $d = $this->admin->organizationDetail($id);
        $org = $d['organization'];

        return $this->ok([
            'organization' => (new OrganizationResource($org))->resolve($request),
            'wallet' => $org->wallet ? ['balance' => Money::round((string) $org->wallet->balance, 4), 'lowBalanceThreshold' => Money::round((string) $org->wallet->lowBalanceThreshold, 2)] : null,
            'members' => TeamMemberResource::collection($org->members)->resolve($request),
            'senderIds' => SenderIdResource::collection($org->senderIds)->resolve($request),
            'campaigns' => CampaignResource::collection($d['campaigns'])->resolve($request),
            'payments' => PaymentResource::collection($d['payments'])->resolve($request),
            'transactions' => TransactionResource::collection($d['transactions'])->resolve($request),
            'sent30' => $d['sent30'],
            'failed30' => $d['failed30'],
            'audits' => AuditLogResource::collection($d['audits'])->resolve($request),
            'apiKeys' => ApiKeyResource::collection($d['apiKeys'])->resolve($request),
            'tickets' => $d['tickets']->map(fn ($t) => ['id' => $t->id, 'number' => $t->number, 'subject' => $t->subject, 'status' => $t->status->value,
                'priority' => $t->priority->value, 'createdAt' => Dhaka::iso($t->createdAt), 'lastReplyAt' => Dhaka::iso($t->lastReplyAt)])->values(),
            'statusTotals30' => $d['statusTotals30'],
            'verification' => $d['verification'],
            'planHistory' => AuditLogResource::collection($d['planHistory'])->resolve($request),
        ]);
    }

    public function updateControls(OrgControlsRequest $request, string $id): JsonResponse
    {
        $this->admin->updateControls($this->admin($request), $id, $request->payload());

        return $this->ok(['message' => 'Account controls saved.']);
    }

    /** POST /admin/customers/{id}/status {status: ACTIVE|SUSPENDED, reason} — a reason is required in both directions. */
    public function status(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:ACTIVE,SUSPENDED'], 'reason' => ['required', 'string', 'min:5', 'max:500']]);
        $this->admin->setOrganizationStatus($this->admin($request), $id, $data['status'], isset($data['reason']) ? trim($data['reason']) ?: null : null);

        return $this->ok(['id' => $id, 'status' => $data['status']]);
    }

    /** GET /admin/wallets?page=: wallets by balance, platform total, number below their alert threshold. */
    public function wallets(Request $request): JsonResponse
    {
        $page = Wallet::query()->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name', 'status'])])
            ->orderByDesc('balance')->paginate(25, ['*'], 'page', $this->page($request));
        $totals = DB::selectOne('SELECT CAST(COALESCE(SUM(balance), 0) AS CHAR) AS total, COUNT(CASE WHEN balance < lowBalanceThreshold THEN 1 END) AS low FROM wallets');

        return $this->ok($page->getCollection()->map(fn (Wallet $w) => [
            'id' => $w->id,
            'organization' => $w->organization ? ['id' => $w->organization->id, 'name' => $w->organization->name, 'status' => $w->organization->status->value] : null,
            'balance' => Money::round((string) $w->balance, 2),
            'lowBalanceThreshold' => Money::round((string) $w->lowBalanceThreshold, 2),
            'updatedAt' => Dhaka::iso($w->updatedAt),
        ])->values(), 200, [
            'page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'total' => $page->total(), 'totalPages' => $page->lastPage(),
            'totalBalance' => Money::round((string) $totals->total, 2), 'belowThreshold' => (int) $totals->low,
        ]);
    }
}
