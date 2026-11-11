<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\OrganizationMember;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Role;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\Auth\PasswordHasher;
use App\Services\Auth\SessionService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Payment receiving methods, customer top-up requests, staff review and crediting (docs/22). */
class ManualTopUpTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const PASSWORD = 'correct horse battery staple';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
        config(['smsflow.features.manual_topups' => true]);
        Storage::fake('local');
        Mail::fake();
    }

    /** @return array{headers: array<string, string>, user: User} */
    private function superAdmin(): array
    {
        $user = User::factory()->platformRole('SUPER_ADMIN')->create(['passwordHash' => app(PasswordHasher::class)->hash(self::PASSWORD)]);
        $token = app(SessionService::class)->create($user->id, null, false, '127.0.0.1', 'phpunit')['token'];

        return ['headers' => ['Authorization' => "Bearer {$token}"], 'user' => $user];
    }

    private function method(array $sa, array $over = []): string
    {
        return $this->postJson('/api/v1/admin/payment-methods', $over + [
            'type' => 'BKASH', 'displayName' => 'bKash Merchant', 'accountNumber' => '01700000000', 'accountType' => 'merchant',
            'instructions' => 'Use Payment, reference = your account email.', 'minAmount' => 500, 'maxAmount' => 50000,
            'requireProof' => false, 'requireSenderNumber' => true, 'currentPassword' => self::PASSWORD,
        ], $sa['headers'])->assertCreated()->json('data.id');
    }

    private function submit(array $t, string $methodId, array $over = [], ?UploadedFile $proof = null)
    {
        $data = $over + ['paymentMethodId' => $methodId, 'amount' => 1000, 'transactionId' => 'BK9X7Y6Z', 'senderNumber' => '01811111111', 'paidAt' => '2026-10-07T11:30', 'note' => 'Paid'];
        if ($proof) {
            $data['proof'] = $proof;
        }

        return $this->withHeaders($t['headers'] + ['Accept' => 'application/json'])->post('/api/v1/app/topup-requests', $data);
    }

    public function test_only_super_admin_changes_methods_with_password_and_audit(): void
    {
        $sa = $this->superAdmin();
        $this->postJson('/api/v1/admin/payment-methods', ['type' => 'BKASH', 'displayName' => 'x', 'accountNumber' => '01700000000'], $this->staff('ADMIN'))->assertForbidden();
        $t = $this->tenant();
        $this->postJson('/api/v1/admin/payment-methods', ['type' => 'BKASH', 'displayName' => 'x', 'accountNumber' => '01700000000'], $t['headers'])->assertForbidden();
        $this->postJson('/api/v1/admin/payment-methods', ['type' => 'BKASH', 'displayName' => 'bKash', 'accountNumber' => '01700000000', 'currentPassword' => 'wrong'], $sa['headers'])->assertStatus(422);
        $this->postJson('/api/v1/admin/payment-methods', ['type' => 'BKASH', 'displayName' => 'bKash', 'accountNumber' => '12', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertStatus(422);
        $this->postJson('/api/v1/admin/payment-methods', ['type' => 'BANK', 'displayName' => 'Bank', 'accountNumber' => '1234567890', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertStatus(422);
        $id = $this->method($sa);
        $this->putJson("/api/v1/admin/payment-methods/{$id}", ['type' => 'BKASH', 'displayName' => 'bKash Merchant', 'accountNumber' => '01799999999', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertOk();
        $log = AuditLog::query()->where('action', 'payment_method.update')->firstOrFail();
        $this->assertSame(['01700000000', '01799999999'], [$log->metadata['before']['accountNumber'], $log->metadata['after']['accountNumber']]);
        $id2 = $this->method($sa, ['type' => 'NAGAD', 'displayName' => 'Nagad', 'accountNumber' => '01900000000']);
        $this->postJson('/api/v1/admin/payment-methods/reorder', ['ids' => [$id2, $id]], $sa['headers'])->assertOk();
        $this->assertSame([1, 2], [PaymentMethod::query()->findOrFail($id2)->sortOrder, PaymentMethod::query()->findOrFail($id)->sortOrder]);
    }

    public function test_customer_sees_active_methods_only(): void
    {
        $sa = $this->superAdmin();
        $a = $this->method($sa);
        $b = $this->method($sa, ['displayName' => 'Old', 'active' => false]);
        $t = $this->tenant();
        $r = $this->getJson('/api/v1/app/payment-methods', $t['headers'])->assertOk();
        $this->assertSame([$a], array_column($r->json('data.methods'), 'id'));
        $r->assertJsonMissingPath('data.methods.0.createdById');
        $this->getJson("/api/v1/app/payment-methods/{$b}/qr", $t['headers'])->assertStatus(404);
    }

    public function test_qr_upload_is_validated_and_served_privately(): void
    {
        $sa = $this->superAdmin();
        $id = $this->method($sa);
        $png = UploadedFile::fake()->createWithContent('qr.png', "\x89PNG\r\n\x1a\n".str_repeat("\0", 64));
        $this->withHeaders($sa['headers'] + ['Accept' => 'application/json'])->post("/api/v1/admin/payment-methods/{$id}/qr", ['file' => UploadedFile::fake()->createWithContent('qr.png', 'not an image'), 'currentPassword' => self::PASSWORD])->assertStatus(422);
        $this->withHeaders($sa['headers'] + ['Accept' => 'application/json'])->post("/api/v1/admin/payment-methods/{$id}/qr", ['file' => UploadedFile::fake()->createWithContent('qr.pdf', "%PDF-1.4\n"), 'currentPassword' => self::PASSWORD])->assertStatus(422);
        $this->withHeaders($sa['headers'] + ['Accept' => 'application/json'])->post("/api/v1/admin/payment-methods/{$id}/qr", ['file' => $png, 'currentPassword' => self::PASSWORD])->assertOk()->assertJsonPath('data.hasQr', true);
        $t = $this->tenant();
        $this->get("/api/v1/app/payment-methods/{$id}/qr", $t['headers'])->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->flushHeaders()->get("/api/v1/app/payment-methods/{$id}/qr")->assertUnauthorized();
    }

    public function test_submission_validates_and_never_credits(): void
    {
        $sa = $this->superAdmin();
        $id = $this->method($sa, ['requireProof' => true]);
        $t = $this->tenant('0');
        $this->submit($t, $id)->assertStatus(422)->assertJsonPath('error.details.field', 'proof');
        $this->submit($t, $id, ['amount' => 100], UploadedFile::fake()->createWithContent('p.png', "\x89PNG\r\n\x1a\n0000"))->assertStatus(422)->assertJsonPath('error.details.field', 'amount');
        $this->submit($t, $id, ['senderNumber' => ''], UploadedFile::fake()->createWithContent('p.png', "\x89PNG\r\n\x1a\n0000"))->assertStatus(422);
        $this->submit($t, $id, ['paidAt' => '2026-12-01T10:00'], UploadedFile::fake()->createWithContent('p.png', "\x89PNG\r\n\x1a\n0000"))->assertStatus(422);
        $this->submit($t, $id, [], UploadedFile::fake()->createWithContent('p.exe', 'MZ'))->assertStatus(422);
        $r = $this->submit($t, $id, [], UploadedFile::fake()->createWithContent('p.png', "\x89PNG\r\n\x1a\n0000"))->assertCreated();
        $r->assertJsonPath('data.status', 'pending')->assertJsonPath('data.amount', '1000.00')->assertJsonPath('data.total', '1150.00')
            ->assertJsonPath('data.transactionId', 'BK9X7Y6Z')->assertJsonPath('data.hasProof', true)->assertJsonMissingPath('data.flags');
        $this->assertSame('0.0000', $this->balance($t['org']));
        $this->assertSame(0, WalletTransaction::query()->count());
        // Same transaction again from this account is refused.
        $this->submit($t, $id, [], UploadedFile::fake()->createWithContent('p.png', "\x89PNG\r\n\x1a\n0000"))->assertStatus(409);
        $key = Payment::query()->findOrFail($r->json('data.id'))->metadata['proof']['key'];
        $this->assertStringStartsWith("orgs/{$t['org']->id}/payment-proofs/", $key);
    }

    public function test_approval_credits_exactly_once_and_checks_amount_and_reference(): void
    {
        $sa = $this->superAdmin();
        $mid = $this->method($sa);
        $t = $this->tenant('0');
        $id = $this->submit($t, $mid)->assertCreated()->json('data.id');
        $this->postJson("/api/v1/admin/topup-requests/{$id}/under-review", [], $this->staff('ADMIN'))->assertOk()->assertJsonPath('data.status', 'under_review');
        $this->getJson("/api/v1/app/topup-requests/{$id}", $t['headers'])->assertJsonPath('data.status', 'under_review');
        $approve = fn (array $over = []) => $this->postJson("/api/v1/admin/topup-requests/{$id}/approve", $over + ['receivedAmount' => '1150', 'reference' => 'bk9x7y6z', 'currentPassword' => self::PASSWORD], $sa['headers']);
        $this->postJson("/api/v1/admin/topup-requests/{$id}/approve", ['receivedAmount' => '1150', 'reference' => 'BK9X7Y6Z'], $this->staff('ADMIN'))->assertForbidden();
        $approve(['receivedAmount' => '1000'])->assertStatus(422)->assertJsonPath('error.details.field', 'receivedAmount');
        $approve(['reference' => 'OTHER'])->assertStatus(422);
        $approve(['currentPassword' => 'nope'])->assertStatus(422);
        $approve()->assertOk()->assertJsonPath('data.status', 'approved');
        $approve()->assertStatus(409);
        $this->postJson("/api/v1/admin/topup-requests/{$id}/reject", ['reason' => 'late', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertStatus(409);
        $this->assertSame('1000.0000', $this->balance($t['org']));
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'TOPUP')->where('referenceId', $id)->count());
        $this->assertSame(1, Invoice::query()->where('paymentId', $id)->count());
    }

    public function test_rejection_needs_reason_and_never_credits(): void
    {
        $sa = $this->superAdmin();
        $mid = $this->method($sa);
        $t = $this->tenant('0');
        $id = $this->submit($t, $mid)->json('data.id');
        $this->postJson("/api/v1/admin/topup-requests/{$id}/reject", ['reason' => '', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertStatus(422);
        $this->postJson("/api/v1/admin/topup-requests/{$id}/reject", ['reason' => 'No such transaction on our account', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->getJson("/api/v1/app/topup-requests/{$id}", $t['headers'])->assertJsonPath('data.rejectionReason', 'No such transaction on our account');
        $this->postJson("/api/v1/admin/topup-requests/{$id}/approve", ['receivedAmount' => '1150', 'reference' => 'BK9X7Y6Z', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertStatus(409);
        $this->assertSame('0.0000', $this->balance($t['org']));
    }

    public function test_staff_cannot_approve_their_own_organizations_payment(): void
    {
        $sa = $this->superAdmin();
        $mid = $this->method($sa);
        $t = $this->tenant('0');
        $id = $this->submit($t, $mid)->json('data.id');
        OrganizationMember::query()->forceCreate(['organizationId' => $t['org']->id, 'userId' => $sa['user']->id, 'roleId' => Role::query()->where('organizationId', $t['org']->id)->where('key', 'ADMIN')->value('id'), 'joinedAt' => now()]);
        $this->postJson("/api/v1/admin/topup-requests/{$id}/approve", ['receivedAmount' => '1150', 'reference' => 'BK9X7Y6Z', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertForbidden();
        // A customer cannot reach staff endpoints at all.
        $this->postJson("/api/v1/admin/topup-requests/{$id}/approve", ['receivedAmount' => '1150', 'reference' => 'BK9X7Y6Z'], $t['headers'])->assertForbidden();
        $this->assertSame('0.0000', $this->balance($t['org']));
    }

    public function test_reference_reused_by_another_account_is_flagged_and_cannot_be_credited_twice(): void
    {
        $sa = $this->superAdmin();
        $mid = $this->method($sa);
        $a = $this->tenant('0');
        $b = $this->tenant('0');
        $ida = $this->submit($a, $mid)->json('data.id');
        $idb = $this->submit($b, $mid)->assertCreated()->json('data.id');
        $this->getJson("/api/v1/admin/topup-requests/{$idb}", $sa['headers'])->assertOk()->assertJsonPath('data.flags.0', 'Transaction ID already used by another account');
        $this->postJson("/api/v1/admin/topup-requests/{$ida}/approve", ['receivedAmount' => '1150', 'reference' => 'BK9X7Y6Z', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertOk();
        $this->postJson("/api/v1/admin/topup-requests/{$idb}/approve", ['receivedAmount' => '1150', 'reference' => 'BK9X7Y6Z', 'currentPassword' => self::PASSWORD], $sa['headers'])->assertStatus(409);
        $this->assertSame(['1000.0000', '0.0000'], [$this->balance($a['org']), $this->balance($b['org'])]);
    }

    public function test_requests_and_proofs_are_tenant_isolated(): void
    {
        $sa = $this->superAdmin();
        $mid = $this->method($sa);
        $t = $this->tenant('0');
        $other = $this->tenant('0');
        $id = $this->submit($t, $mid, [], UploadedFile::fake()->createWithContent('p.png', "\x89PNG\r\n\x1a\n0000"))->json('data.id');
        $this->getJson("/api/v1/app/topup-requests/{$id}", $other['headers'])->assertStatus(404);
        $this->get("/api/v1/app/topup-requests/{$id}/proof", $other['headers'])->assertStatus(404);
        $this->postJson("/api/v1/app/topup-requests/{$id}/cancel", [], $other['headers'])->assertStatus(404);
        $this->getJson('/api/v1/app/topup-requests', $other['headers'])->assertOk()->assertJsonPath('meta.total', 0);
        $this->get("/api/v1/app/topup-requests/{$id}/proof", $t['headers'])->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $this->get("/api/v1/admin/topup-requests/{$id}/proof", $sa['headers'])->assertOk();
        $this->assertSame(1, AuditLog::query()->where('action', 'admin.topup_request.proof_view')->count());
    }

    public function test_customer_can_cancel_only_before_review_and_admin_filters_work(): void
    {
        $sa = $this->superAdmin();
        $mid = $this->method($sa);
        $t = $this->tenant('0');
        $id = $this->submit($t, $mid)->json('data.id');
        $this->getJson('/api/v1/admin/topup-requests?status=pending', $sa['headers'])->assertOk()->assertJsonPath('meta.total', 1);
        $this->postJson("/api/v1/admin/topup-requests/{$id}/notes", ['note' => 'Checked bKash statement'], $sa['headers'])->assertOk()->assertJsonPath('data.internalNotes.0.note', 'Checked bKash statement');
        $this->getJson("/api/v1/app/topup-requests/{$id}", $t['headers'])->assertJsonMissingPath('data.internalNotes');
        $this->postJson("/api/v1/app/topup-requests/{$id}/cancel", [], $t['headers'])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->getJson('/api/v1/admin/topup-requests?status=cancelled&methodId='.$mid, $sa['headers'])->assertOk()->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/admin/topup-requests?status=pending', $sa['headers'])->assertOk()->assertJsonPath('meta.total', 0);
    }

    public function test_feature_flag_hides_the_module(): void
    {
        config(['smsflow.features.manual_topups' => false]);
        $t = $this->tenant();
        $this->getJson('/api/v1/app/payment-methods', $t['headers'])->assertStatus(403)->assertJsonPath('error.code', 'FEATURE_DISABLED');
    }
}
