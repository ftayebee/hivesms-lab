<?php

namespace App\Http\Controllers\Api\V1\Sms;

use App\Exceptions\AppException;
use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Resources\PublicMessageResource;
use App\Models\Message;
use App\Models\SenderId;
use App\Services\Sms\SmsCostCalculator;
use App\Services\Wallet\WalletService;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Read endpoints of the public API (API-key auth): messages, balance, sender IDs. */
class PublicApiController extends ApiController
{
    /** GET /api/v1/messages — newest first, keyset cursor = base64url("<createdAt ISO>|<id>"). */
    public function messages(Request $request): JsonResponse
    {
        $q = $request->validate([
            'status' => ['nullable', 'in:queued,submitted,delivered,failed,rejected,expired,cancelled'],
            'to' => ['nullable', 'string', 'max:32'],
            'reference' => ['nullable', 'string', 'max:100'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'until' => ['nullable', 'date_format:Y-m-d'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'cursor' => ['nullable', 'string', 'max:200'],
        ]);
        $limit = (int) ($q['limit'] ?? 25);
        $query = Message::query()->where('organizationId', $this->tenant($request)->organizationId);
        if (! empty($q['status'])) {
            $query->where('status', strtoupper($q['status']));
        }
        if (! empty($q['to'])) {
            $query->where('to', Phone::normalize($q['to']) ?? $q['to']);
        }
        if (! empty($q['reference'])) {
            $query->where('clientReference', $q['reference']);
        }
        if (! empty($q['from'])) {
            $query->where('createdAt', '>=', CarbonImmutable::parse($q['from'], 'UTC')->format('Y-m-d H:i:s.v'));
        }
        if (! empty($q['until'])) {
            $query->where('createdAt', '<', CarbonImmutable::parse($q['until'], 'UTC')->addDay()->format('Y-m-d H:i:s.v'));
        }
        if (! empty($q['cursor'])) {
            [$at, $id] = $this->decodeCursor($q['cursor']);
            $query->where(fn ($w) => $w->where('createdAt', '<', $at)->orWhere(fn ($x) => $x->where('createdAt', $at)->where('id', '<', $id)));
        }
        $rows = $query->orderByDesc('createdAt')->orderByDesc('id')->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        $page = $rows->take($limit);
        $last = $page->last();

        return $this->ok(PublicMessageResource::collection($page)->resolve($request), 200, [
            'hasMore' => $hasMore,
            'nextCursor' => $hasMore && $last ? rtrim(strtr(base64_encode(Dhaka::iso($last->createdAt).'|'.$last->id), '+/', '-_'), '=') : null,
        ]);
    }

    /** @return array{0: string, 1: string} */
    private function decodeCursor(string $c): array
    {
        $raw = base64_decode(strtr($c, '-_', '+/'), true);
        $parts = $raw !== false ? explode('|', $raw, 2) : [];
        try {
            if (count($parts) !== 2 || $parts[1] === '') {
                throw new \InvalidArgumentException;
            }

            return [CarbonImmutable::parse($parts[0])->utc()->format('Y-m-d H:i:s.v'), $parts[1]];
        } catch (\Throwable) {
            throw new AppException(ErrorCode::INVALID_REQUEST, 'Invalid cursor.');
        }
    }

    /** GET /api/v1/messages/{id} — other tenants' ids are 404. */
    public function message(Request $request, string $id): JsonResponse
    {
        if (! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Message not found.');
        }
        $m = Message::query()->with(['events' => fn ($q) => $q->orderBy('occurredAt')])
            ->where('organizationId', $this->tenant($request)->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Message not found.');

        return $this->ok((new PublicMessageResource($m))->resolve($request));
    }

    /** GET /api/v1/balance — balance and the account's per-segment rates. */
    public function balance(Request $request, WalletService $wallet, SmsCostCalculator $pricing): JsonResponse
    {
        $orgId = $this->tenant($request)->organizationId;
        $plan = $pricing->planFor($orgId);
        $r = fn (string $t, string $s) => Money::round(SmsCostCalculator::rateFor($plan, $t, $s), 4);

        return $this->ok([
            'balance' => Money::round($wallet->balance($orgId), 4),
            'currency' => 'BDT',
            'plan' => $plan->name,
            'rates' => [
                'transactional' => ['masking' => $r('TRANSACTIONAL', 'MASKING'), 'non_masking' => $r('TRANSACTIONAL', 'NON_MASKING')],
                'promotional' => ['masking' => $r('PROMOTIONAL', 'MASKING'), 'non_masking' => $r('PROMOTIONAL', 'NON_MASKING')],
            ],
        ]);
    }

    /** GET /api/v1/sender-ids */
    public function senderIds(Request $request): JsonResponse
    {
        $rows = SenderId::query()->where('organizationId', $this->tenant($request)->organizationId)->orderByDesc('isDefault')->orderBy('value')->get();

        return $this->ok($rows->map(fn (SenderId $s) => [
            'sender_id' => $s->value,
            'type' => $s->type->value === 'MASKING' ? 'masking' : 'non_masking',
            'status' => strtolower($s->status->value),
            'default' => $s->isDefault && $s->status->value === 'APPROVED',
            'approved_at' => Dhaka::iso($s->approvedAt),
            'rejection_reason' => $s->status->value === 'REJECTED' ? $s->rejectionReason : null,
        ])->values());
    }
}
