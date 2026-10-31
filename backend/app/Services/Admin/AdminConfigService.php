<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\BlocklistEntry;
use App\Models\CreditPackage;
use App\Models\Organization;
use App\Models\PricingPlan;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\SettingsService;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Platform configuration (port of features/admin/config.ts): pricing plans, credit packages,
 * billing/SMS policies, provider credentials (encrypted, never returned), site content, blocklist.
 * Every change is audited with before/after (never including secret values).
 */
class AdminConfigService
{
    public function __construct(private readonly SettingsService $settings, private readonly AuditLogger $audit) {}

    /** Price-bearing plan fields: changes to these are listed separately in the audit log. */
    public const PLAN_PRICE_FIELDS = ['minRechargeAmount', 'transactionalNonMasking', 'transactionalMasking', 'promotionalNonMasking', 'promotionalMasking', 'senderIdFee'];

    /**
     * Creates or updates a plan. Price semantics (docs/18 § Pricing): per-SMS rates apply to messages
     * sent after the change by every organization on the plan; sent messages keep their unitPrice/cost
     * snapshot and wallet balances are BDT, so nothing is re-charged retroactively. Updates need a
     * reason; the audit entry records only the changed fields (before → after), the reason and how many
     * organizations the change affects.
     *
     * @return array{plan: PricingPlan, affectedOrganizations: int, changed: array<string, array{before: mixed, after: mixed}>}
     */
    public function savePlan(AdminContext $admin, array $input, ?string $id = null, ?string $reason = null): array
    {
        if (PricingPlan::query()->where('key', $input['key'])->when($id, fn ($q) => $q->where('id', '!=', $id))->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'Another plan uses this key.', ['field' => 'key']);
        }
        $before = $id ? PricingPlan::query()->find($id) : null;
        if ($id && ! $before) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Plan not found.');
        }
        if ($id && ! $reason) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Say why the plan changes.', ['field' => 'reason']);
        }
        $snapshot = $before?->toArray() ?? [];
        $plan = DB::transaction(function () use ($input, $id, $before) {
            if ($input['isDefault']) {
                PricingPlan::query()->where('isDefault', true)->when($id, fn ($q) => $q->where('id', '!=', $id))->update(['isDefault' => false]);
            }
            if ($before) {
                $before->forceFill($input)->save();

                return $before;
            }

            return PricingPlan::query()->forceCreate($input);
        });
        $after = $plan->refresh()->toArray();
        $changed = [];
        foreach ($input as $k => $_) {
            $b = $snapshot[$k] ?? null;
            $a = $after[$k] ?? null;
            $same = in_array($k, self::PLAN_PRICE_FIELDS, true) && $b !== null && $a !== null ? Money::cmp((string) $b, (string) $a) === 0 : $b == $a;
            if (! $same) {
                $changed[$k] = ['before' => $b, 'after' => $a];
            }
        }
        $affected = Organization::query()->where('pricingPlanId', $plan->id)->count()
            + ($plan->isDefault ? Organization::query()->whereNull('pricingPlanId')->count() : 0);
        $this->audit->log($id ? 'pricing.plan.update' : 'pricing.plan.create', $admin->actor(), null, 'pricing_plan', $plan->id, [
            'changed' => $changed,
            'priceChanged' => (bool) array_intersect(array_keys($changed), self::PLAN_PRICE_FIELDS),
            'affectedOrganizations' => $affected,
            'reason' => $reason,
        ], $admin->ip, $admin->userAgent);

        return ['plan' => $plan, 'affectedOrganizations' => $affected, 'changed' => $changed];
    }

    public function savePackage(AdminContext $admin, array $input, ?string $id = null): CreditPackage
    {
        $before = $id ? CreditPackage::query()->find($id) : null;
        if ($id && ! $before) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Package not found.');
        }
        $snapshot = $before?->toArray();
        if ($before) {
            $before->forceFill($input)->save();
            $pkg = $before;
        } else {
            $pkg = CreditPackage::query()->forceCreate($input);
        }
        $this->audit->log($id ? 'pricing.package.update' : 'pricing.package.create', $admin->actor(), null, 'credit_package', $pkg->id, ['before' => $snapshot, 'after' => $pkg->toArray()], $admin->ip);

        return $pkg;
    }

    public function saveBillingPolicy(AdminContext $admin, array $input): array
    {
        if ((float) $input['maximumTopUp'] < (float) $input['minimumTopUp']) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Maximum must be at least the minimum.', ['field' => 'maximumTopUp']);
        }
        $before = $this->settings->billingPolicy();
        $num = fn ($v) => $v + 0;
        $input = ['vatRatePercent' => $num($input['vatRatePercent']), 'minimumTopUp' => $num($input['minimumTopUp']), 'maximumTopUp' => $num($input['maximumTopUp']), 'balanceValidityMonths' => (int) ($input['balanceValidityMonths'] ?? 0), 'invoicePrefix' => $input['invoicePrefix']];
        $value = $input + ['pricesExcludeVat' => true];
        $value['balanceValidityMonths'] = $input['balanceValidityMonths'] ?: null;
        $this->settings->set('billing.policy', $value, $admin->userId);
        $this->audit->log('pricing.billing_policy.update', $admin->actor(), null, 'setting', 'billing.policy', ['before' => $before, 'after' => $value], $admin->ip);

        return $this->settings->billingPolicy();
    }

    public function saveSmsPolicy(AdminContext $admin, array $i): array
    {
        foreach (['gsmSingle', 'gsmMulti', 'ucsSingle', 'ucsMulti', 'maxSegments', 'quietStart', 'quietEnd', 'reviewThresholdRecipients'] as $k) {
            $i[$k] = (int) $i[$k];
        }
        $before = $this->settings->smsPolicy();
        $value = [
            'segmentation' => ['gsm7' => ['single' => $i['gsmSingle'], 'multipart' => $i['gsmMulti']], 'ucs2' => ['single' => $i['ucsSingle'], 'multipart' => $i['ucsMulti']], 'maxSegments' => $i['maxSegments']],
            'refundFailedMessages' => $i['refundFailedMessages'],
            'promotionalQuietHours' => $i['quietHoursEnabled'] ? ['start' => $i['quietStart'], 'end' => $i['quietEnd']] : null,
            'appendOptOutText' => $i['appendOptOutText'],
            'promotionalOptOutText' => $i['promotionalOptOutText'],
            'reviewThresholdRecipients' => $i['reviewThresholdRecipients'],
            'optOutKeywords' => array_slice(array_values(array_filter(array_map('trim', preg_split('/[,\s]+/u', $i['optOutKeywords']) ?: []))), 0, 20),
        ];
        $this->settings->set('sms.policy', $value, $admin->userId);
        $this->audit->log('settings.sms_policy.update', $admin->actor(), null, 'setting', 'sms.policy', ['before' => $before, 'after' => $value], $admin->ip);

        return $this->settings->smsPolicy();
    }

    private function applySecret(string $key, ?string $value, bool $clear, AdminContext $admin): void
    {
        if ($clear) {
            $this->settings->setSecret($key, null, $admin->userId);
        } elseif ($value !== null && $value !== '') {
            $this->settings->setSecret($key, $value, $admin->userId);
        }
    }

    public function saveSmsProvider(AdminContext $admin, array $i): void
    {
        if ($i['provider'] === 'http' && ! str_starts_with((string) $i['url'], 'https://')) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, "Enter the provider's HTTPS endpoint.", ['field' => 'url']);
        }
        if ($i['provider'] === 'mock' && app()->isProduction()) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The mock provider cannot be used in production.', ['field' => 'provider']);
        }
        $before = $this->settings->smsProviderSettings();
        $mapping = array_filter(['to' => $i['mapTo'] ?? '', 'message' => $i['mapMessage'] ?? '', 'senderId' => $i['mapSenderId'] ?? '', 'apiKey' => $i['mapApiKey'] ?? ''], fn ($v) => $v !== '');
        $this->settings->set('sms.provider', ['provider' => $i['provider'], 'url' => (string) ($i['url'] ?? ''), 'mapping' => (object) $mapping], $admin->userId);
        $this->applySecret('sms.provider.apiKey', $i['apiKey'] ?? null, $i['clearSecrets'], $admin);
        $this->applySecret('sms.provider.apiSecret', $i['apiSecret'] ?? null, $i['clearSecrets'], $admin);
        $this->applySecret('sms.provider.webhookSecret', $i['webhookSecret'] ?? null, $i['clearSecrets'], $admin);
        $this->settings->clearCache();
        $this->audit->log('settings.sms_provider.update', $admin->actor(), null, 'setting', 'sms.provider', [
            'before' => $before,
            'after' => ['provider' => $i['provider'], 'url' => $i['url'] ?? '', 'mapping' => $mapping],
            // Never log secret values; only whether they changed.
            'secretsChanged' => (bool) (($i['apiKey'] ?? '') || ($i['apiSecret'] ?? '') || ($i['webhookSecret'] ?? '') || $i['clearSecrets']),
        ], $admin->ip);
    }

    public function savePaymentSettings(AdminContext $admin, array $i): void
    {
        $before = $this->settings->paymentSettings();
        $value = ['enabled' => array_values($i['enabled']), 'manualInstructions' => $i['manualInstructions'], 'sslcommerz' => ['storeId' => (string) ($i['sslStoreId'] ?? ''), 'live' => $i['sslLive']]];
        $this->settings->set('payments', $value, $admin->userId);
        $this->applySecret('payments.sslcommerz.storePassword', $i['sslStorePassword'] ?? null, $i['clearSslPassword'], $admin);
        $this->settings->clearCache();
        $this->audit->log('settings.payments.update', $admin->actor(), null, 'setting', 'payments', ['before' => $before, 'after' => $value, 'secretChanged' => (bool) (($i['sslStorePassword'] ?? '') || $i['clearSslPassword'])], $admin->ip);
    }

    public function saveSiteContent(AdminContext $admin, array $i): void
    {
        $before = $this->settings->siteContent();
        $value = [
            'contact' => array_intersect_key($i, array_flip(['email', 'supportEmail', 'salesEmail', 'abuseEmail', 'phone', 'address', 'hours'])),
            'announcement' => array_filter(['enabled' => $i['announcementEnabled'], 'text' => $i['announcementText'] ?? '', 'href' => ($i['announcementHref'] ?? '') ?: null], fn ($v) => $v !== null),
        ];
        $this->settings->set('site.content', $value, $admin->userId);
        $this->audit->log('settings.site_content.update', $admin->actor(), null, 'setting', 'site.content', ['before' => $before, 'after' => $value], $admin->ip);
    }

    /** @return array<string, mixed> everything the admin settings page shows — secrets only as set/not set */
    public function settingsOverview(): array
    {
        return [
            'smsPolicy' => $this->settings->smsPolicy(),
            'billingPolicy' => $this->settings->billingPolicy(),
            'smsProvider' => $this->settings->smsProviderSettings(),
            'payments' => $this->settings->paymentSettings(),
            'siteContent' => $this->settings->siteContent(),
            'secrets' => $this->settings->secretStatus(),
        ];
    }

    public function addBlocklist(AdminContext $admin, string $type, string $value, ?string $reason): BlocklistEntry
    {
        $value = match ($type) {
            'URL_DOMAIN' => preg_replace('#/.*$#', '', preg_replace('#^https?://#i', '', mb_strtolower($value))),
            'KEYWORD' => mb_strtolower($value),
            default => $value,
        };
        $e = BlocklistEntry::query()->where('type', $type)->where('value', $value)->first();
        if ($e) {
            $e->forceFill(['reason' => $reason])->save();
        } else {
            $e = BlocklistEntry::query()->forceCreate(['type' => $type, 'value' => $value, 'reason' => $reason, 'createdById' => $admin->userId]);
        }
        $this->audit->log('admin.blocklist.add', $admin->actor(), null, 'blocklist', $e->id, ['type' => $type, 'value' => $value]);

        return $e;
    }

    public function removeBlocklist(AdminContext $admin, string $id): void
    {
        $e = BlocklistEntry::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Entry not found.');
        $e->delete();
        $this->audit->log('admin.blocklist.remove', $admin->actor(), null, 'blocklist', $id, ['type' => $e->type->value, 'value' => $e->value]);
    }
}
