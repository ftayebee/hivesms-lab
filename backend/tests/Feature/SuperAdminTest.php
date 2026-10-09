<?php

namespace Tests\Feature;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\AuditLog;
use App\Models\Message;
use App\Models\Payment;
use App\Models\PricingPlan;
use App\Models\Setting;
use App\Models\User;
use App\Models\VerificationToken;
use App\Models\WalletTransaction;
use App\Services\Admin\StaffService;
use App\Services\Auth\SessionService;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Super Admin panel (docs/17, docs/18): authorization, privilege safety, money safety, audit hygiene. */
class SuperAdminTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const PW = UserFactory::PASSWORD;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    /** @return array{user: User, headers: array<string, string>} */
    private function staffUser(string $role): array
    {
        $user = User::factory()->platformRole($role)->create();
        $token = app(SessionService::class)->create($user->id, null, false, '127.0.0.1', 'phpunit')['token'];

        return ['user' => $user, 'headers' => ['Authorization' => "Bearer {$token}"]];
    }

    private function adjust(array $headers, string $orgId, array $over = [])
    {
        return $this->postJson("/api/v1/admin/customers/{$orgId}/wallet-adjustments", $over + [
            'direction' => 'CREDIT', 'amount' => '50.00', 'reason' => 'Goodwill credit for outage', 'idempotencyKey' => 'adj_'.Str::random(20), 'currentPassword' => self::PW,
        ], $headers);
    }

    // ─── Access control ───

    public function test_customers_and_organization_admins_cannot_reach_platform_administration(): void
    {
        $owner = $this->tenant('10');
        $orgAdmin = $this->tenant('10', 'ADMIN');
        foreach ([$owner['headers'], $orgAdmin['headers']] as $h) {
            foreach (['dashboard', 'customers', "customers/{$owner['org']->id}", 'finance/summary', 'finance/transactions', 'finance/margins', 'finance/provider-costs', 'system/health', 'exports/customers', 'staff/permissions', 'users'] as $path) {
                $this->getJson("/api/v1/admin/{$path}", $h)->assertForbidden();
            }
            $this->adjust($h, $owner['org']->id)->assertForbidden();
        }
        $this->getJson('/api/v1/admin/dashboard')->assertUnauthorized();
        $this->assertSame('10.0000', $this->balance($owner['org']));
    }

    public function test_support_staff_get_no_financial_pricing_or_staff_powers(): void
    {
        $t = $this->tenant('10');
        $support = $this->staffUser('SUPPORT')['headers'];
        $plan = PricingPlan::query()->firstOrFail();
        $this->getJson('/api/v1/admin/customers', $support)->assertOk();
        $this->getJson('/api/v1/admin/dashboard', $support)->assertOk()->assertJsonPath('data.finance', null)->assertJsonPath('data.recentPrivilegedActions', null);
        $this->adjust($support, $t['org']->id)->assertForbidden();
        $this->putJson("/api/v1/admin/pricing/plans/{$plan->id}", ['key' => 'starter', 'name' => 'Starter', 'minRechargeAmount' => '500', 'transactionalNonMasking' => '0.01',
            'transactionalMasking' => '0.01', 'promotionalNonMasking' => '0.01', 'promotionalMasking' => '0.01', 'senderIdFee' => '0', 'reason' => 'cheaper please'], $support)->assertForbidden();
        $this->getJson('/api/v1/admin/finance/summary', $support)->assertForbidden();
        $this->getJson('/api/v1/admin/exports/payments', $support)->assertForbidden();
        $this->postJson('/api/v1/admin/staff', ['email' => 'x@example.com', 'name' => 'X', 'role' => 'SUPER_ADMIN', 'reason' => 'promote me', 'currentPassword' => self::PW], $support)->assertForbidden();
        $this->assertSame('10.0000', $this->balance($t['org']));
        $this->assertSame('0.4000', (string) $plan->refresh()->transactionalNonMasking);
    }

    public function test_admins_read_finance_but_cannot_move_money_or_manage_staff(): void
    {
        $t = $this->tenant('10');
        $admin = $this->staffUser('ADMIN')['headers'];
        $this->getJson('/api/v1/admin/finance/summary', $admin)->assertOk();
        $this->getJson('/api/v1/admin/system/health', $admin)->assertOk()->assertJsonStructure(['data' => ['ok', 'checks' => ['database']]]);
        $this->adjust($admin, $t['org']->id)->assertForbidden();
        $this->putJson('/api/v1/admin/finance/provider-costs', [], $admin)->assertForbidden();
        $this->getJson('/api/v1/admin/staff/permissions', $admin)->assertForbidden();
        $this->assertSame('10.0000', $this->balance($t['org']));
    }

    public function test_super_admin_dashboard_uses_real_aggregates_and_separates_liability_from_receipts(): void
    {
        $a = $this->tenant('120.50');
        $this->tenant('30');
        Payment::query()->forceCreate(['organizationId' => $a['org']->id, 'provider' => 'manual', 'amount' => '500', 'vatRate' => '15', 'vatAmount' => '75', 'total' => '575', 'creditAmount' => '510', 'status' => 'SUCCEEDED', 'completedAt' => now()]);
        $owner = $this->staffUser('SUPER_ADMIN')['headers'];
        $d = $this->getJson('/api/v1/admin/dashboard?range=7d', $owner)->assertOk()->json('data');
        $this->assertSame(2, $d['customers']['total']);
        $this->assertSame('150.50', $d['finance']['liability']['balance']);
        $this->assertSame('500.00', $d['finance']['receipts']['net']);
        $this->assertSame('575.00', $d['finance']['receipts']['gross']);
        $this->assertSame('10.00', $d['finance']['receipts']['bonusCredit']);
        $this->assertSame('not_configured', $d['finance']['providerCost']['basis']);
        $this->assertFalse($d['subscriptions']['supported']);
        $this->assertIsArray($d['recentPrivilegedActions']);
    }

    // ─── Privilege safety ───

    public function test_staff_cannot_promote_themselves_and_changes_need_password_and_reason(): void
    {
        ['user' => $me, 'headers' => $h] = $this->staffUser('SUPER_ADMIN');
        $this->putJson("/api/v1/admin/users/{$me->id}/access", ['platformRole' => 'USER', 'reason' => 'testing self', 'currentPassword' => self::PW], $h)->assertForbidden();
        ['user' => $admin, 'headers' => $adminH] = $this->staffUser('ADMIN');
        $this->putJson("/api/v1/admin/users/{$admin->id}/access", ['platformRole' => 'SUPER_ADMIN', 'reason' => 'self promotion', 'currentPassword' => self::PW], $adminH)->assertForbidden();

        $target = User::factory()->create();
        $this->putJson("/api/v1/admin/users/{$target->id}/access", ['platformRole' => 'SUPPORT', 'currentPassword' => self::PW], $h)->assertStatus(422)->assertJsonFragment(['path' => 'reason']);
        $this->putJson("/api/v1/admin/users/{$target->id}/access", ['platformRole' => 'SUPPORT', 'reason' => 'joins support team'], $h)->assertStatus(422);
        $this->putJson("/api/v1/admin/users/{$target->id}/access", ['platformRole' => 'SUPPORT', 'reason' => 'joins support team', 'currentPassword' => 'wrong-password'], $h)
            ->assertStatus(422)->assertJsonPath('error.details.field', 'currentPassword');
        $this->assertSame('USER', $target->refresh()->platformRole->value);

        $this->putJson("/api/v1/admin/users/{$target->id}/access", ['platformRole' => 'SUPPORT', 'reason' => 'joins support team', 'currentPassword' => self::PW], $h)->assertOk();
        $this->assertSame('SUPPORT', $target->refresh()->platformRole->value);
        $log = AuditLog::query()->where('action', 'admin.user.access_update')->where('targetId', $target->id)->firstOrFail();
        $this->assertSame(['before' => ['platformRole' => 'USER', 'status' => 'ACTIVE'], 'after' => ['platformRole' => 'SUPPORT'], 'reason' => 'joins support team'], $log->metadata);
        $this->assertSame($me->id, $log->actorUserId);
    }

    public function test_the_last_active_owner_cannot_be_demoted_or_suspended(): void
    {
        ['user' => $a, 'headers' => $ha] = $this->staffUser('SUPER_ADMIN');
        ['user' => $b] = $this->staffUser('SUPER_ADMIN');
        // With two owners, one may demote the other…
        $this->putJson("/api/v1/admin/users/{$b->id}/access", ['platformRole' => 'ADMIN', 'reason' => 'role change', 'currentPassword' => self::PW], $ha)->assertOk();
        // …but a request racing it (B's context still says SUPER_ADMIN) cannot remove the last owner.
        $staleB = new AdminContext($b->id, $b->name, 'SUPER_ADMIN');
        foreach ([['ADMIN', null], [null, 'SUSPENDED']] as [$role, $status]) {
            try {
                app(StaffService::class)->updateAccess($staleB, $a->id, $role, $status, 'race condition');
                $this->fail('the last owner was removed');
            } catch (AppException $e) {
                $this->assertSame('CONFLICT', $e->errorCode->value);
            }
        }
        $a->refresh();
        $this->assertSame(['SUPER_ADMIN', 'ACTIVE'], [$a->platformRole->value, $a->status->value]);
    }

    public function test_wrong_passwords_lock_privileged_actions_and_never_reach_the_audit_log(): void
    {
        $t = $this->tenant('10');
        $h = $this->staffUser('SUPER_ADMIN')['headers'];
        for ($i = 0; $i < 5; $i++) {
            $this->adjust($h, $t['org']->id, ['currentPassword' => "Guess-{$i}-secret"])->assertStatus(422);
        }
        $this->adjust($h, $t['org']->id)->assertStatus(429);
        $this->assertSame('10.0000', $this->balance($t['org']));
        $this->assertSame(5, AuditLog::query()->where('action', 'admin.reauth.failed')->count());
        $this->assertTrue(AuditLog::query()->where('action', 'admin.reauth.locked')->exists());
        $all = AuditLog::query()->get()->toJson();
        $this->assertStringNotContainsString('Guess-', $all);
        $this->assertStringNotContainsString(self::PW, $all);
    }

    public function test_staff_invitation_creates_an_account_without_a_known_password(): void
    {
        $h = $this->staffUser('SUPER_ADMIN')['headers'];
        $res = $this->postJson('/api/v1/admin/staff', ['email' => 'New.Agent@Example.com', 'name' => 'New Agent', 'role' => 'SUPPORT', 'reason' => 'hired for support', 'currentPassword' => self::PW], $h)
            ->assertCreated()->assertJsonPath('meta.created', true)->assertJsonPath('data.platformRole', 'SUPPORT');
        $this->assertArrayNotHasKey('passwordHash', $res->json('data'));
        $u = User::query()->where('email', 'new.agent@example.com')->firstOrFail();
        $this->assertTrue(VerificationToken::query()->where('userId', $u->id)->where('type', 'PASSWORD_RESET')->whereNull('consumedAt')->exists());
        $this->assertTrue(AuditLog::query()->where('action', 'admin.staff.invite')->where('targetId', $u->id)->exists());
        // Inviting an existing account grants the role instead.
        $existing = User::factory()->create();
        $this->postJson('/api/v1/admin/staff', ['email' => $existing->email, 'name' => 'x x', 'role' => 'ADMIN', 'reason' => 'promotion to admin', 'currentPassword' => self::PW], $h)->assertOk()->assertJsonPath('meta.created', false);
        $this->assertSame('ADMIN', $existing->refresh()->platformRole->value);
    }

    public function test_owner_bootstrap_command_is_one_time_and_needs_confirmation(): void
    {
        $this->artisan('platform:bootstrap-owner', ['email' => 'owner@example.com', '--confirm-email' => 'other@example.com', '--no-interaction' => true])->assertExitCode(1);
        $this->assertFalse(User::query()->where('email', 'owner@example.com')->exists());
        $this->artisan('platform:bootstrap-owner', ['email' => 'owner@example.com', '--confirm-email' => 'owner@example.com', '--no-interaction' => true])
            ->expectsOutputToContain('/reset-password?token=')->assertExitCode(0);
        $owner = User::query()->where('email', 'owner@example.com')->firstOrFail();
        $this->assertSame('SUPER_ADMIN', $owner->platformRole->value);
        $this->assertTrue(AuditLog::query()->where('action', 'admin.bootstrap_owner')->where('targetId', $owner->id)->exists());
        // Never a second time while an owner exists.
        $this->artisan('platform:bootstrap-owner', ['email' => 'intruder@example.com', '--confirm-email' => 'intruder@example.com', '--no-interaction' => true])->assertExitCode(1);
        $this->assertFalse(User::query()->where('email', 'intruder@example.com')->exists());
    }

    // ─── Customers ───

    public function test_customer_search_detail_and_recovery_without_secrets(): void
    {
        $t = $this->tenant('10', 'OWNER', [], ['phone' => '+8801712345670']);
        $other = $this->tenant('5');
        $this->apiKey($t['org']);
        $admin = $this->staffUser('ADMIN')['headers'];
        foreach (['01712345670', $t['org']->id, strtoupper($t['user']->email)] as $q) {
            $this->getJson('/api/v1/admin/customers?q='.urlencode($q), $admin)->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $t['org']->id);
        }
        $this->getJson('/api/v1/admin/customers?planId=none', $admin)->assertOk();
        $this->getJson('/api/v1/admin/customers?from='.now()->addDays(2)->format('Y-m-d'), $admin)->assertOk()->assertJsonPath('meta.total', 0);
        $d = $this->getJson("/api/v1/admin/customers/{$t['org']->id}", $admin)->assertOk()->json('data');
        $this->assertCount(1, $d['apiKeys']);
        $json = json_encode($d);
        $this->assertStringNotContainsString('keyHash', $json);
        $this->assertStringNotContainsString('passwordHash', $json);
        $this->assertArrayHasKey('emailVerified', $d['verification'][0]);
        $this->assertStringNotContainsString($other['org']->id, $json);

        $this->postJson("/api/v1/admin/users/{$t['user']->id}/password-reset", ['reason' => 'customer locked out'], $admin)->assertOk();
        $this->assertTrue(VerificationToken::query()->where('userId', $t['user']->id)->where('type', 'PASSWORD_RESET')->exists());
        $staff = $this->staffUser('SUPPORT')['user'];
        $this->postJson("/api/v1/admin/users/{$staff->id}/password-reset", [], $admin)->assertForbidden();
    }

    public function test_suspension_blocks_sending_and_api_keys_and_reactivation_needs_a_reason(): void
    {
        $t = $this->tenant('100');
        $key = $this->apiKey($t['org']);
        $admin = $this->staffUser('ADMIN')['headers'];
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'SUSPENDED'], $admin)->assertStatus(422);
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'SUSPENDED', 'reason' => 'Spam complaints'], $admin)->assertOk();
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $key['headers'])->assertForbidden();
        $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => '01712345671', 'scheduleMode' => 'now'], $t['headers'] + ['Idempotency-Key' => 'k-'.Str::random(16)])
            ->assertForbidden()->assertJsonPath('error.code', 'ACCOUNT_SUSPENDED');
        $this->assertSame(0, Message::query()->where('organizationId', $t['org']->id)->count());
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'ACTIVE'], $admin)->assertStatus(422);
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'ACTIVE', 'reason' => 'Issue resolved'], $admin)->assertOk();
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $key['headers'])->assertSuccessful();
        $this->assertSame(['Spam complaints', 'Issue resolved'], AuditLog::query()->whereIn('action', ['admin.organization.suspend', 'admin.organization.activate'])->orderBy('createdAt')->get()->pluck('metadata.reason')->all());
    }

    // ─── Money ───

    public function test_adjustments_are_idempotent_audited_ledgered_and_never_negative(): void
    {
        $t = $this->tenant('10');
        $owner = $this->staffUser('SUPER_ADMIN')['headers'];
        $key = 'adj_'.Str::random(24);
        $this->adjust($owner, $t['org']->id, ['idempotencyKey' => $key])->assertCreated()->assertJsonPath('data.replayed', false);
        $this->adjust($owner, $t['org']->id, ['idempotencyKey' => $key])->assertOk()->assertJsonPath('data.replayed', true);
        $this->adjust($owner, $t['org']->id, ['idempotencyKey' => $key, 'amount' => '60'])->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_CONFLICT');
        $this->assertSame('60.0000', $this->balance($t['org']));
        $this->assertSame(1, WalletTransaction::query()->where('referenceType', 'admin_adjustment')->where('referenceId', $key)->count());

        $this->adjust($owner, $t['org']->id, ['direction' => 'DEBIT', 'amount' => '60.01'])->assertStatus(402)->assertJsonPath('error.code', 'INSUFFICIENT_BALANCE');
        $this->assertSame('60.0000', $this->balance($t['org']));
        foreach (['-5', '1e3', '0', '0.001', 'abc'] as $bad) {
            $this->adjust($owner, $t['org']->id, ['amount' => $bad])->assertStatus(422);
        }
        $this->adjust($owner, $t['org']->id, ['reason' => 'x'])->assertStatus(422);
        $this->adjust($owner, $t['org']->id, ['direction' => 'DEBIT', 'amount' => '60.00'])->assertCreated();
        $this->assertSame('0.0000', $this->balance($t['org']));
        $log = AuditLog::query()->where('action', 'admin.wallet.adjust')->orderByDesc('createdAt')->firstOrFail();
        $this->assertSame(['60.0000', '0.0000', 'Goodwill credit for outage'], [$log->metadata['balanceBefore'], $log->metadata['balanceAfter'], $log->metadata['reason']]);
    }

    public function test_payment_refund_debits_the_credit_once_and_records_it(): void
    {
        $t = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 600, 'provider' => 'manual'], $t['headers'] + ['Idempotency-Key' => 'p-'.Str::random(16)])->json('data.payment.id');
        $this->postJson("/api/v1/app/payments/{$id}/reference", ['reference' => 'BKASH-1'], $t['headers'])->assertOk();
        $admin = $this->staffUser('ADMIN')['headers'];
        $owner = $this->staffUser('SUPER_ADMIN')['headers'];
        // Duplicate approvals credit once.
        $this->postJson("/api/v1/admin/payments/{$id}/review", ['decision' => 'approve'], $admin)->assertOk();
        $this->postJson("/api/v1/admin/payments/{$id}/review", ['decision' => 'approve'], $owner)->assertOk();
        $this->assertSame('600.0000', $this->balance($t['org']));

        $this->postJson("/api/v1/admin/payments/{$id}/refund", ['reason' => 'Customer cancelled', 'currentPassword' => self::PW], $admin)->assertForbidden();
        $this->postJson("/api/v1/admin/payments/{$id}/refund", ['reason' => 'Customer cancelled', 'currentPassword' => self::PW], $owner)->assertOk()->assertJsonPath('data.status', 'REFUNDED');
        $this->postJson("/api/v1/admin/payments/{$id}/refund", ['reason' => 'Customer cancelled', 'currentPassword' => self::PW], $owner)->assertStatus(409);
        $this->assertSame('0.0000', $this->balance($t['org']));
        $tx = WalletTransaction::query()->where('referenceType', 'payment_refund')->where('referenceId', $id)->sole();
        $this->assertSame(['DEBIT', '600.0000'], [$tx->type->value, (string) $tx->amount]);
        $this->assertTrue(AuditLog::query()->where('action', 'payment.refund')->where('targetId', $id)->exists());
        $summary = $this->getJson('/api/v1/admin/finance/summary?range=today', $owner)->json('data');
        $this->assertSame('600.00', $summary['paymentRefunds']['amount']);
        $this->assertSame('0.00', $summary['liability']['balance']);
    }

    public function test_refund_never_makes_a_wallet_negative(): void
    {
        $t = $this->tenant('0');
        $p = Payment::query()->forceCreate(['organizationId' => $t['org']->id, 'provider' => 'manual', 'amount' => '500', 'total' => '500', 'creditAmount' => '500', 'status' => 'SUCCEEDED', 'completedAt' => now()]);
        $owner = $this->staffUser('SUPER_ADMIN')['headers'];
        $this->postJson("/api/v1/admin/payments/{$p->id}/refund", ['reason' => 'Customer cancelled', 'currentPassword' => self::PW], $owner)->assertStatus(409);
        $this->assertSame('0.0000', $this->balance($t['org']));
        $this->assertSame('SUCCEEDED', $p->refresh()->status->value);
    }

    // ─── Pricing ───

    public function test_price_updates_are_validated_audited_and_keep_historical_message_prices(): void
    {
        $t = $this->tenant('100');
        $key = $this->apiKey($t['org']);
        $plan = PricingPlan::query()->firstOrFail();
        $t['org']->forceFill(['pricingPlanId' => $plan->id])->save();
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'old price'], $key['headers'])->assertSuccessful();

        $owner = $this->staffUser('SUPER_ADMIN')['headers'];
        $body = ['key' => 'starter', 'name' => 'Starter', 'minRechargeAmount' => '500', 'transactionalNonMasking' => '0.50', 'transactionalMasking' => '0.60',
            'promotionalNonMasking' => '0.40', 'promotionalMasking' => '0.60', 'senderIdFee' => '0', 'isDefault' => true, 'isPublic' => true, 'active' => true];
        $this->putJson("/api/v1/admin/pricing/plans/{$plan->id}", $body, $owner)->assertStatus(422)->assertJsonFragment(['path' => 'reason']);
        foreach (['-0.1', '1e1', '0.12345', '101'] as $bad) {
            $this->putJson("/api/v1/admin/pricing/plans/{$plan->id}", ['transactionalNonMasking' => $bad, 'reason' => 'bad value'] + $body, $owner)->assertStatus(422);
        }
        $this->putJson("/api/v1/admin/pricing/plans/{$plan->id}", $body + ['reason' => 'Provider cost increase'], $owner)
            ->assertOk()->assertJsonPath('meta.affectedOrganizations', 1)->assertJsonPath('meta.changedFields', ['transactionalNonMasking']);
        $log = AuditLog::query()->where('action', 'pricing.plan.update')->firstOrFail();
        $this->assertSame('Provider cost increase', $log->metadata['reason']);
        $this->assertTrue($log->metadata['priceChanged']);
        $this->assertSame(['transactionalNonMasking'], array_keys($log->metadata['changed']));

        $this->postJson('/api/v1/sms/send', ['to' => '01712345679', 'message' => 'new price'], $key['headers'])->assertSuccessful();
        $prices = Message::query()->where('organizationId', $t['org']->id)->orderBy('createdAt')->pluck('unitPrice')->map(fn ($v) => (string) $v)->all();
        $this->assertSame(['0.4000', '0.5000'], $prices);
    }

    public function test_provider_costs_are_owner_only_and_margins_are_labelled_estimates(): void
    {
        $t = $this->tenant('100');
        $key = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $key['headers'])->assertSuccessful();
        Setting::query()->delete();
        Message::query()->update(['submittedAt' => now()]);
        $owner = $this->staffUser('SUPER_ADMIN')['headers'];
        $admin = $this->staffUser('ADMIN')['headers'];
        $body = ['provider' => 'http', 'rates' => ['transactionalMasking' => '0.30', 'transactionalNonMasking' => '0.25', 'promotionalMasking' => '0.30', 'promotionalNonMasking' => '0.25'],
            'effectiveFrom' => now()->format('Y-m-d'), 'source' => 'Contract #42 (signed)', 'reason' => 'Initial verified rates', 'currentPassword' => self::PW];
        $this->getJson('/api/v1/admin/finance/margins', $admin)->assertOk()->assertJsonPath('meta.basis', 'not_configured')->assertJsonPath('data.0.estimatedCost', null);
        $this->putJson('/api/v1/admin/finance/provider-costs', $body, $admin)->assertForbidden();
        $this->putJson('/api/v1/admin/finance/provider-costs', ['rates' => ['transactionalNonMasking' => '-1'] + $body['rates']] + $body, $owner)->assertStatus(422);
        $this->putJson('/api/v1/admin/finance/provider-costs', $body, $owner)->assertOk()->assertJsonPath('data.rates.transactionalNonMasking', '0.2500');
        $m = $this->getJson('/api/v1/admin/finance/margins?range=today', $admin)->assertOk()->assertJsonPath('meta.basis', 'estimate')->json();
        $this->assertSame('0.4000', $m['data'][0]['billed']);
        $this->assertSame('0.2500', $m['data'][0]['estimatedCost']);
        $this->assertSame('0.1500', $m['data'][0]['estimatedMargin']);
        $this->getJson('/api/v1/admin/finance/provider-costs', $admin)->assertOk()->assertJsonPath('data.history.0.metadata.reason', 'Initial verified rates');
        // Only the cost setting was written: the sending-provider configuration is untouched.
        $this->assertSame(['sms.provider.costs'], Setting::query()->pluck('key')->all());
    }

    // ─── Exports ───

    public function test_exports_enforce_permissions_and_exclude_personal_data_and_secrets(): void
    {
        $t = $this->tenant('10', 'OWNER', [], ['email' => 'private.person@example.com', 'phone' => '+8801712345671']);
        $this->apiKey($t['org']);
        $owner = $this->staffUser('SUPER_ADMIN')['headers'];
        $support = $this->staffUser('SUPPORT')['headers'];
        $this->get('/api/v1/admin/exports/customers', $support)->assertForbidden();
        $this->get('/api/v1/admin/exports/customers', $t['headers'])->assertForbidden();
        $this->get('/api/v1/admin/exports/nope', $owner)->assertNotFound();
        $this->adjust($owner, $t['org']->id, ['reason' => '=HYPERLINK("http://evil")'])->assertCreated();
        foreach (['customers', 'payments', 'transactions', 'margins', 'audit-logs'] as $kind) {
            $res = $this->get("/api/v1/admin/exports/{$kind}?range=today", $owner)->assertOk();
            $csv = $res->streamedContent();
            $this->assertStringContainsString(',', $csv, $kind);
            foreach (['private.person@example.com', '8801712345671', 'passwordHash', 'keyHash', self::PW, '127.0.0.1'] as $secret) {
                $this->assertStringNotContainsString($secret, $csv, "{$kind} leaks {$secret}");
            }
        }
        // CSV-injection safe: a reason starting with "=" is exported as text.
        $audit = $this->get('/api/v1/admin/exports/audit-logs?range=today', $owner)->streamedContent();
        $this->assertStringContainsString('"\'=HYPERLINK(""http://evil"")"', $audit);
        $this->assertSame(6, AuditLog::query()->where('action', 'admin.export')->count());
    }
}
