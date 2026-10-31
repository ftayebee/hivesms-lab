<?php

namespace Tests\Feature;

use App\Exceptions\AppException;
use App\Models\Organization;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Services\Wallet\WalletService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Wallet safety under real concurrency. Uses committed data (separate processes cannot see a test
 * transaction), created and removed by this class; the schema is adopted with a plain migrate.
 */
class WalletConcurrencyTest extends TestCase
{
    private ?Organization $org = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->artisan('migrate', ['--force' => true]);
        $this->org = Organization::query()->forceCreate(['name' => 'Race Co', 'slug' => 'race-'.Str::lower(Str::random(8))]);
        Wallet::query()->forceCreate(['organizationId' => $this->org->id, 'balance' => '1.0000']);
    }

    protected function tearDown(): void
    {
        if ($this->org) {
            Organization::withTrashed()->whereKey($this->org->id)->forceDelete(); // cascades wallet + ledger
        }
        parent::tearDown();
    }

    private function balance(): string
    {
        return (string) DB::scalar('SELECT CAST(balance AS CHAR) FROM wallets WHERE organizationId = ?', [$this->org->id]);
    }

    public function test_concurrent_debits_never_overspend(): void
    {
        $startAt = microtime(true) + 2.0;
        $procs = [];
        for ($i = 0; $i < 5; $i++) {
            $cmd = [PHP_BINARY, base_path('tests/Support/debit-race.php'), $this->org->id, '0.40', (string) $startAt, "ref-{$i}"];
            $procs[] = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes[$i], base_path());
        }
        $results = [];
        foreach ($procs as $i => $p) {
            $results[] = trim(stream_get_contents($pipes[$i][1]).stream_get_contents($pipes[$i][2]));
            proc_close($p);
        }
        sort($results);
        $this->assertSame(['insufficient', 'insufficient', 'insufficient', 'ok', 'ok'], $results, implode(' | ', $results));
        $this->assertSame('0.2000', $this->balance());
        $this->assertSame(2, WalletTransaction::query()->where('organizationId', $this->org->id)->count());
        // The ledger's balanceAfter values form a consistent sequence.
        $this->assertEqualsCanonicalizing(['0.6000', '0.2000'], WalletTransaction::query()->where('organizationId', $this->org->id)->pluck('balanceAfter')->map(fn ($v) => (string) $v)->all());
    }

    public function test_the_same_charge_reference_cannot_be_applied_twice(): void
    {
        $w = app(WalletService::class);
        $entry = ['organizationId' => $this->org->id, 'amount' => '0.10', 'reason' => 'SMS_CHARGE', 'description' => 'x', 'referenceType' => 'send_batch', 'referenceId' => 'batch-1'];
        DB::transaction(fn () => $w->debit($entry));
        try {
            DB::transaction(fn () => $w->debit($entry));
            $this->fail('duplicate charge was accepted');
        } catch (QueryException $e) {
            $this->assertSame(1062, $e->errorInfo[1]);
        }
        // The failed duplicate rolled back its balance change too.
        $this->assertSame('0.9000', $this->balance());
    }

    public function test_debit_requires_a_transaction_and_never_goes_negative(): void
    {
        $w = app(WalletService::class);
        try {
            $w->debit(['organizationId' => $this->org->id, 'amount' => '0.10', 'reason' => 'SMS_CHARGE', 'description' => 'x']);
            $this->fail('debit outside a transaction');
        } catch (\LogicException) {
        }
        $this->expectException(AppException::class);
        DB::transaction(fn () => $w->debit(['organizationId' => $this->org->id, 'amount' => '1.0001', 'reason' => 'SMS_CHARGE', 'description' => 'x', 'referenceType' => 't', 'referenceId' => '1']));
    }

    public function test_credit_resets_the_low_balance_flag_when_above_threshold(): void
    {
        Wallet::query()->where('organizationId', $this->org->id)->update(['lowBalanceNotifiedAt' => now()]);
        DB::transaction(fn () => app(WalletService::class)->credit(['organizationId' => $this->org->id, 'amount' => '500', 'reason' => 'TOPUP', 'description' => 't', 'referenceType' => 'payment', 'referenceId' => 'p1']));
        $this->assertNull(Wallet::query()->where('organizationId', $this->org->id)->value('lowBalanceNotifiedAt'));
        $this->assertSame('501.0000', $this->balance());
    }
}
