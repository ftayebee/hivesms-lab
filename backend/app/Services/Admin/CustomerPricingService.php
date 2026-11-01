<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\Organization;
use App\Models\PricingPlan;
use App\Services\Platform\AuditLogger;
use App\Services\Sms\SmsCostCalculator;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Per-customer SMS prices. A customer's prices live in their own private plan, so billing, margins
 * and usage reports treat it like any other plan and no schema change is needed. Rates are per SMS
 * segment and apply to messages priced after the change: queued messages keep what they were charged.
 */
class CustomerPricingService
{
    public const KEY_PREFIX = 'customer-';

    public function __construct(private readonly SmsCostCalculator $pricing, private readonly AuditLogger $audit) {}

    public static function isPrivateKey(?string $key): bool
    {
        return $key !== null && str_starts_with($key, self::KEY_PREFIX);
    }

    /** @return array{custom: bool, planName: string, maskingRate: string, nonMaskingRate: string} */
    public function current(string $organizationId): array
    {
        $this->organization($organizationId);
        $plan = $this->pricing->planFor($organizationId);

        return [
            'custom' => self::isPrivateKey($plan->key),
            'planName' => $plan->name,
            'maskingRate' => Money::round(SmsCostCalculator::rateFor($plan, 'TRANSACTIONAL', 'MASKING'), 4),
            'nonMaskingRate' => Money::round(SmsCostCalculator::rateFor($plan, 'TRANSACTIONAL', 'NON_MASKING'), 4),
        ];
    }

    public function set(AdminContext $admin, string $organizationId, string $masking, string $nonMasking, string $reason): void
    {
        $org = $this->organization($organizationId);
        $before = $this->current($organizationId);
        $base = $this->pricing->planFor($organizationId);

        DB::transaction(function () use ($admin, $org, $masking, $nonMasking, $reason, $before, $base) {
            $plan = PricingPlan::query()->firstOrNew(['key' => self::KEY_PREFIX.$org->id]);
            $plan->forceFill([
                'name' => 'Custom: '.mb_substr($org->name, 0, 150),
                'description' => 'Private prices for one customer.',
                'minRechargeAmount' => $base->minRechargeAmount,
                'senderIdFee' => $base->senderIdFee,
                'transactionalMasking' => $masking,
                'promotionalMasking' => $masking,
                'transactionalNonMasking' => $nonMasking,
                'promotionalNonMasking' => $nonMasking,
                'features' => [],
                'isCustom' => true,
                'isPublic' => false,
                'isDefault' => false,
                'active' => true,
                'highlighted' => false,
                'sortOrder' => 1000,
            ])->save();
            $org->forceFill(['pricingPlanId' => $plan->id])->save();

            $this->audit->log('admin.organization.pricing_update', $admin->actor(), $org->id, 'organization', $org->id, [
                'before' => $before, 'after' => ['maskingRate' => Money::round($masking, 4), 'nonMaskingRate' => Money::round($nonMasking, 4)], 'reason' => $reason,
            ], ip: $admin->ip);
        });
    }

    /** Back to the default plan. A different plan can then be chosen in the account controls. */
    public function reset(AdminContext $admin, string $organizationId, string $reason): void
    {
        $org = $this->organization($organizationId);
        $before = $this->current($organizationId);
        if (! $before['custom']) {
            throw new AppException(ErrorCode::CONFLICT, 'This customer has no custom prices.');
        }

        DB::transaction(function () use ($admin, $org, $before, $reason) {
            $org->forceFill(['pricingPlanId' => null])->save();
            PricingPlan::query()->where('key', self::KEY_PREFIX.$org->id)->delete();
            $this->audit->log('admin.organization.pricing_reset', $admin->actor(), $org->id, 'organization', $org->id, ['before' => $before, 'reason' => $reason], ip: $admin->ip);
        });
    }

    private function organization(string $id): Organization
    {
        return Organization::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Organization not found.');
    }
}
