<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Admin\PackageRequest;
use App\Http\Requests\Admin\PlanRequest;
use App\Http\Requests\Admin\SettingsRequest;
use App\Http\Resources\PricingPlanResource;
use App\Models\BlocklistEntry;
use App\Models\CreditPackage;
use App\Models\PricingPlan;
use App\Services\Admin\AdminConfigService;
use App\Services\Sms\SmsProviderManager;
use App\Support\Dhaka;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Pricing plans, credit packages, platform settings (secrets write-only), blocklist. */
class AdminSettingsController extends ApiController
{
    public function __construct(private readonly AdminConfigService $config) {}

    public function plans(Request $request): JsonResponse
    {
        return $this->collection($request, PricingPlanResource::class, PricingPlan::query()->orderBy('sortOrder')->get());
    }

    public function storePlan(PlanRequest $request): JsonResponse
    {
        return $this->resource($request, PricingPlanResource::class, $this->config->savePlan($this->admin($request), $request->payload()), 201);
    }

    public function updatePlan(PlanRequest $request, string $id): JsonResponse
    {
        return $this->resource($request, PricingPlanResource::class, $this->config->savePlan($this->admin($request), $request->payload(), $id));
    }

    public function packages(): JsonResponse
    {
        return $this->ok(CreditPackage::query()->orderBy('sortOrder')->get()->map(fn (CreditPackage $p) => [
            'id' => $p->id, 'name' => $p->name, 'amount' => Money::round((string) $p->amount, 2), 'bonusPercent' => Money::plain((string) $p->bonusPercent),
            'description' => $p->description, 'active' => $p->active, 'sortOrder' => $p->sortOrder,
        ])->values());
    }

    public function storePackage(PackageRequest $request): JsonResponse
    {
        $p = $this->config->savePackage($this->admin($request), $request->payload());

        return $this->ok(['id' => $p->id], 201);
    }

    public function updatePackage(PackageRequest $request, string $id): JsonResponse
    {
        $p = $this->config->savePackage($this->admin($request), $request->payload(), $id);

        return $this->ok(['id' => $p->id]);
    }

    /** GET /admin/settings: every section; secrets only as set/not set. */
    public function settings(): JsonResponse
    {
        return $this->ok($this->config->settingsOverview() + ['smsProviders' => SmsProviderManager::OPTIONS]);
    }

    /** PUT /admin/settings/{section}: billing-policy | sms-policy | sms-provider | payments | site-content */
    public function updateSettings(SettingsRequest $request, string $section): JsonResponse
    {
        $admin = $this->admin($request);
        $data = $request->payload();
        match ($section) {
            'billing-policy' => $this->config->saveBillingPolicy($admin, $data),
            'sms-policy' => $this->config->saveSmsPolicy($admin, $data),
            'sms-provider' => $this->config->saveSmsProvider($admin, $data),
            'payments' => $this->config->savePaymentSettings($admin, $data),
            'site-content' => $this->config->saveSiteContent($admin, $data),
        };

        return $this->ok($this->config->settingsOverview());
    }

    public function blocklist(Request $request): JsonResponse
    {
        $q = $request->validate(['type' => ['nullable', 'in:NUMBER,KEYWORD,URL_DOMAIN']]);
        $page = BlocklistEntry::query()->when($q['type'] ?? null, fn ($w, $t) => $w->where('type', $t))->orderByDesc('createdAt')->paginate(50, ['*'], 'page', $this->page($request));

        return $this->ok($page->getCollection()->map(fn (BlocklistEntry $e) => [
            'id' => $e->id, 'type' => $e->type->value, 'value' => $e->value, 'reason' => $e->reason, 'createdAt' => Dhaka::iso($e->createdAt),
        ])->values(), 200, ['page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'total' => $page->total(), 'totalPages' => $page->lastPage()]);
    }

    public function addBlocklist(Request $request): JsonResponse
    {
        $data = $request->validate(['type' => ['required', 'in:NUMBER,KEYWORD,URL_DOMAIN'], 'value' => ['required', 'string', 'min:2', 'max:200'], 'reason' => ['nullable', 'string', 'max:200']]);
        $e = $this->config->addBlocklist($this->admin($request), $data['type'], trim($data['value']), isset($data['reason']) ? trim($data['reason']) ?: null : null);

        return $this->ok(['id' => $e->id, 'type' => $e->type->value, 'value' => $e->value], 201);
    }

    public function removeBlocklist(Request $request, string $id): JsonResponse
    {
        $this->config->removeBlocklist($this->admin($request), $id);

        return $this->ok(['deleted' => true]);
    }
}
