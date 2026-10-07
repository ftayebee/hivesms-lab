<?php

namespace App\Services\Sms;

use App\Models\Organization;
use App\Models\PricingPlan;
use App\Support\Money;
use RuntimeException;

/**
 * Pricing (port of src/lib/pricing.ts + services/billing/pricing.ts). Rates are per SMS segment,
 * BDT, excluding VAT:  cost = segments × recipients × rate(smsType, senderType), 4 dp half-up.
 */
class SmsCostCalculator
{
    public static function rateFor(PricingPlan $plan, string $smsType, string $senderType): string
    {
        $col = match (true) {
            $smsType === 'TRANSACTIONAL' && $senderType === 'MASKING' => 'transactionalMasking',
            $smsType === 'TRANSACTIONAL' => 'transactionalNonMasking',
            $senderType === 'MASKING' => 'promotionalMasking',
            default => 'promotionalNonMasking',
        };

        return Money::normalize((string) $plan->getAttribute($col));
    }

    public static function messageCost(int $segments, int $recipients, string $rate): string
    {
        return Money::round(Money::mul(Money::mul($rate, $segments), $recipients), 4);
    }

    /**
     * Top-up maths: wallet credited with subtotal + package bonus; VAT charged on the subtotal.
     *
     * @return array{subtotal: string, vatRate: string, vatAmount: string, total: string, bonus: string, creditAmount: string}
     */
    public static function topUpBreakdown(string $amount, string $vatRatePercent, string $bonusPercent = '0'): array
    {
        $subtotal = Money::round($amount, 2);
        $vatAmount = Money::round(Money::div(Money::mul($subtotal, $vatRatePercent), 100), 2);
        $bonus = Money::round(Money::div(Money::mul($subtotal, $bonusPercent), 100), 2);

        return [
            'subtotal' => $subtotal,
            'vatRate' => Money::normalize($vatRatePercent),
            'vatAmount' => $vatAmount,
            'total' => Money::round(Money::add($subtotal, $vatAmount), 2),
            'bonus' => $bonus,
            'creditAmount' => Money::round(Money::add($subtotal, $bonus), 2),
        ];
    }

    /** The plan pricing an organization: its own active plan, else the default, else the first active. */
    public function planFor(string $organizationId): PricingPlan
    {
        $org = Organization::query()->with('pricingPlan')->find($organizationId, ['id', 'pricingPlanId']);
        if ($org?->pricingPlan && $org->pricingPlan->active) {
            return $org->pricingPlan;
        }

        return PricingPlan::query()->where('isDefault', true)->where('active', true)->first()
            ?? PricingPlan::query()->where('active', true)->orderBy('sortOrder')->first()
            ?? throw new RuntimeException('No active pricing plan configured. Seed the database or create a plan in Admin → Pricing.');
    }
}
