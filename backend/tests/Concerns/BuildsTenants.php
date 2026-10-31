<?php

namespace Tests\Concerns;

use App\Models\ApiKey;
use App\Models\Organization;
use App\Models\OrganizationMember;
use App\Models\PricingPlan;
use App\Models\Role;
use App\Models\User;
use App\Models\Wallet;
use App\Services\ApiKey\ApiKeyService;
use App\Services\Auth\OrganizationProvisioner;
use App\Services\Auth\SessionService;
use App\Services\Platform\SettingsService;
use Illuminate\Support\Facades\DB;

/**
 * Fixtures for API tests: organizations provisioned exactly like registration does (roles,
 * permissions, owner, wallet), session tokens in the Node format, API keys, a default plan.
 */
trait BuildsTenants
{
    protected function seedPlan(array $rates = []): PricingPlan
    {
        app(SettingsService::class)->clearCache();

        return PricingPlan::query()->where('isDefault', true)->first() ?? PricingPlan::query()->forceCreate($rates + [
            'key' => 'starter', 'name' => 'Starter', 'minRechargeAmount' => '500',
            'transactionalNonMasking' => '0.40', 'transactionalMasking' => '0.60',
            'promotionalNonMasking' => '0.40', 'promotionalMasking' => '0.60',
            'senderIdFee' => '0', 'features' => [], 'isDefault' => true, 'active' => true,
        ]);
    }

    /**
     * @return array{org: Organization, user: User, token: string, headers: array<string, string>}
     */
    protected function tenant(string $balance = '100', string $role = 'OWNER', array $orgAttrs = [], array $userAttrs = []): array
    {
        $this->seedPlan();
        $provisioner = app(OrganizationProvisioner::class);
        $provisioner->ensurePermissionCatalogue();
        $owner = User::factory()->create($userAttrs);
        ['organization' => $org] = DB::transaction(fn () => $provisioner->createOrganizationWithOwner('Acme '.uniqid(), $owner->id));
        $org->forceFill($orgAttrs + ['requireCampaignReview' => false])->save();
        Wallet::query()->where('organizationId', $org->id)->update(['balance' => $balance]);

        $user = $owner;
        if ($role !== 'OWNER') {
            $user = User::factory()->create();
            OrganizationMember::query()->forceCreate([
                'organizationId' => $org->id, 'userId' => $user->id,
                'roleId' => Role::query()->where('organizationId', $org->id)->where('key', $role)->value('id'), 'joinedAt' => now(),
            ]);
        }
        $token = app(SessionService::class)->create($user->id, $org->id, false, '127.0.0.1', 'phpunit')['token'];

        return ['org' => $org->refresh(), 'user' => $user, 'token' => $token, 'headers' => ['Authorization' => "Bearer {$token}"]];
    }

    /** @return array<string, string> */
    protected function staff(string $platformRole): array
    {
        $user = User::factory()->platformRole($platformRole)->create();
        $token = app(SessionService::class)->create($user->id, null, false, '127.0.0.1', 'phpunit')['token'];

        return ['Authorization' => "Bearer {$token}"];
    }

    /** @return array{key: string, headers: array<string, string>, id: string} */
    protected function apiKey(Organization $org, array $scopes = ['sms:send', 'messages:read', 'balance:read', 'sender_ids:read'], array $attrs = []): array
    {
        ['prefix' => $prefix, 'fullKey' => $fullKey, 'keyHash' => $hash] = ApiKeyService::generate();
        $key = ApiKey::query()->forceCreate($attrs + [
            'organizationId' => $org->id, 'name' => 'test', 'prefix' => $prefix, 'keyHash' => $hash, 'scopes' => $scopes, 'ipAllowlist' => [],
        ]);

        return ['key' => $fullKey, 'headers' => ['Authorization' => "Bearer {$fullKey}"], 'id' => $key->id];
    }

    protected function balance(Organization $org): string
    {
        return (string) DB::scalar('SELECT CAST(balance AS CHAR) FROM wallets WHERE organizationId = ?', [$org->id]);
    }
}
