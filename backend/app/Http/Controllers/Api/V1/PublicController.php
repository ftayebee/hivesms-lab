<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\RequestContext;
use App\Http\Requests\PublicForms\AbuseReportRequest;
use App\Http\Requests\PublicForms\ContactFormRequest;
use App\Http\Resources\PricingPlanResource;
use App\Models\PricingPlan;
use App\Services\Platform\PublicFormService;
use App\Services\Platform\SettingsService;
use App\Services\Wallet\BillingService;
use Illuminate\Http\JsonResponse;

/** Unauthenticated website endpoints: pricing, site content, contact and abuse forms. */
class PublicController extends ApiController
{
    public function pricing(SettingsService $settings, BillingService $billing): JsonResponse
    {
        $plans = PricingPlan::query()->where('active', true)->where('isPublic', true)->orderBy('sortOrder')->get();
        $policy = $settings->billingPolicy();

        return $this->ok([
            'plans' => PricingPlanResource::collection($plans)->resolve(request()),
            'packages' => $billing->packages(),
            'vatRatePercent' => $policy['vatRatePercent'],
            'minimumTopUp' => $policy['minimumTopUp'],
            'maximumTopUp' => $policy['maximumTopUp'],
            'balanceValidityMonths' => $policy['balanceValidityMonths'],
        ]);
    }

    /**
     * GET /public/policies: the non-secret, customer-facing parts of sms.policy and billing.policy
     * (segment sizes, quiet hours, opt-out text, recipient limits, VAT, top-up limits). The Next.js
     * panel reads its settings here instead of from its own database. Nothing internal (review or
     * retry tuning, provider details, secrets) is included.
     */
    public function policies(SettingsService $settings): JsonResponse
    {
        $sms = $settings->smsPolicy();
        $billing = $settings->billingPolicy();

        return $this->ok([
            'sms.policy' => [
                'segmentation' => $sms['segmentation'],
                'promotionalQuietHours' => $sms['promotionalQuietHours'],
                'promotionalOptOutText' => $sms['promotionalOptOutText'],
                'appendOptOutText' => (bool) $sms['appendOptOutText'],
                'optOutKeywords' => array_values((array) $sms['optOutKeywords']),
                'maxBulkRecipients' => (int) $sms['maxBulkRecipients'],
                'maxCampaignRecipients' => (int) $sms['maxCampaignRecipients'],
            ],
            'billing.policy' => [
                'vatRatePercent' => $billing['vatRatePercent'],
                'pricesExcludeVat' => (bool) $billing['pricesExcludeVat'],
                'minimumTopUp' => $billing['minimumTopUp'],
                'maximumTopUp' => $billing['maximumTopUp'],
                'balanceValidityMonths' => $billing['balanceValidityMonths'],
                'invoicePrefix' => $billing['invoicePrefix'],
            ],
        ]);
    }

    public function siteContent(SettingsService $settings): JsonResponse
    {
        return $this->ok($settings->siteContent());
    }

    /** Honeypot `website` filled → pretend success, store nothing. */
    public function contact(ContactFormRequest $request, PublicFormService $forms): JsonResponse
    {
        if ($request->filled('website')) {
            return $this->ok(['message' => "Thanks, we'll be in touch."]);
        }
        $forms->contactRequest($request->validated(), RequestContext::ip($request));

        return $this->ok(['message' => 'Thanks for getting in touch. Our team usually replies within one working day.'], 201);
    }

    public function abuse(AbuseReportRequest $request, PublicFormService $forms): JsonResponse
    {
        if ($request->filled('website')) {
            return $this->ok(['message' => 'Thank you. Your report was received.']);
        }
        $forms->abuseReport($request->validated(), RequestContext::ip($request));

        return $this->ok(['message' => 'Thank you. Our trust and safety team will review this report.'], 201);
    }
}
