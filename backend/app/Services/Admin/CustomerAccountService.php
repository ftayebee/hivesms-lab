<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Mail\EmailTemplates;
use App\Models\PricingPlan;
use App\Models\User;
use App\Services\Auth\OrganizationProvisioner;
use App\Services\Auth\PasswordHasher;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\Mailer;
use App\Support\ErrorCode;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Customer accounts opened by a super admin (Admin → Customers → New customer). Creates exactly
 * what self-registration creates (user, organization, roles, owner membership, wallet) in one
 * transaction, with the password the admin chose. The password is never logged or audited.
 * Works while public registration is closed.
 */
class CustomerAccountService
{
    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly OrganizationProvisioner $provisioner,
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer,
    ) {}

    /**
     * @param  array{company: string, name: string, email: string, phone: ?string, password: string, pricingPlanId: ?string, emailVerified: bool, sendWelcome: bool}  $input
     * @return array{userId: string, organizationId: string}
     */
    public function create(AdminContext $admin, array $input): array
    {
        $taken = User::withTrashed()->where('email', $input['email'])
            ->when($input['phone'], fn ($q) => $q->orWhere('phone', $input['phone']))
            ->first(['email']);
        if ($taken) {
            $email = $taken->email === $input['email'];
            throw new AppException(ErrorCode::CONFLICT, $email ? 'An account with this email already exists.' : 'This mobile number is already registered.', ['field' => $email ? 'email' : 'phone']);
        }
        if ($input['pricingPlanId'] && ! PricingPlan::query()->whereKey($input['pricingPlanId'])->where('active', true)->exists()) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Choose an active pricing plan.', ['field' => 'pricingPlanId']);
        }

        $hash = $this->hasher->hash($input['password']);
        $this->provisioner->ensurePermissionCatalogue();
        try {
            [$user, $org] = DB::transaction(function () use ($admin, $input, $hash) {
                $user = User::query()->forceCreate([
                    'name' => $input['name'],
                    'email' => $input['email'],
                    'phone' => $input['phone'],
                    'passwordHash' => $hash,
                    'emailVerifiedAt' => $input['emailVerified'] ? now() : null,
                ]);
                $org = $this->provisioner->createOrganizationWithOwner($input['company'], $user->id, null, $input['pricingPlanId'])['organization'];
                $this->audit->log('admin.customer.create', $admin->actor(), $org->id, 'organization', $org->id, [
                    'ownerUserId' => $user->id, 'email' => $input['email'], 'company' => $input['company'],
                    'pricingPlanId' => $input['pricingPlanId'], 'emailVerified' => $input['emailVerified'],
                ], $admin->ip, $admin->userAgent);

                return [$user, $org];
            });
        } catch (QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                $phone = str_contains($e->getMessage(), 'phone');
                throw new AppException(ErrorCode::CONFLICT, $phone ? 'This mobile number is already registered.' : 'An account with this email already exists.', ['field' => $phone ? 'phone' : 'email']);
            }
            throw $e;
        }

        if ($input['sendWelcome']) {
            try {
                $this->mailer->send($user->email, EmailTemplates::welcome($user->name));
            } catch (Throwable $e) {
                Log::warning('welcome email for admin-created customer failed', ['user' => Mailer::maskEmail($user->email), 'error' => $e->getMessage()]);
            }
        }

        return ['userId' => $user->id, 'organizationId' => $org->id];
    }
}
