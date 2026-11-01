<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Services\Admin\CustomerPricingService;
use App\Services\Admin\PrivilegedActionGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** A customer's own SMS prices. Changing them is super-admin only and re-confirms the password. */
class AdminCustomerPricingController extends ApiController
{
    public function __construct(private readonly CustomerPricingService $pricing, private readonly PrivilegedActionGuard $guard) {}

    /** GET /admin/customers/{id}/pricing */
    public function show(string $id): JsonResponse
    {
        return $this->ok($this->pricing->current($id));
    }

    /** PUT /admin/customers/{id}/pricing {maskingRate, nonMaskingRate, reason, currentPassword} */
    public function update(Request $request, string $id): JsonResponse
    {
        $rate = ['required', 'string', 'regex:/^\d{1,3}(\.\d{1,4})?$/', 'not_regex:/^0+(\.0+)?$/'];
        $data = $request->validate([
            'maskingRate' => $rate,
            'nonMaskingRate' => $rate,
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ], [
            'maskingRate.*' => 'Enter a price above 0, with up to 4 decimals.',
            'nonMaskingRate.*' => 'Enter a price above 0, with up to 4 decimals.',
            'reason.*' => 'Explain the change (at least 5 characters).',
            'currentPassword.*' => 'Confirm with your current password.',
        ]);
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $data['currentPassword']);
        $this->pricing->set($admin, $id, $data['maskingRate'], $data['nonMaskingRate'], trim($data['reason']));

        return $this->ok($this->pricing->current($id));
    }

    /** POST /admin/customers/{id}/pricing/reset {reason, currentPassword}: back to the default plan. */
    public function reset(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ], [
            'reason.*' => 'Explain the change (at least 5 characters).',
            'currentPassword.*' => 'Confirm with your current password.',
        ]);
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $data['currentPassword']);
        $this->pricing->reset($admin, $id, trim($data['reason']));

        return $this->ok($this->pricing->current($id));
    }
}
