<?php

/*
 * Child process for WalletConcurrencyTest: boots the app (test environment inherited from the
 * parent), waits for the shared start time, then tries to debit the wallet in a transaction.
 * Prints "ok" or "insufficient".
 */

use App\Exceptions\AppException;
use App\Services\Wallet\WalletService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$script, $orgId, $amount, $startAt, $ref] = $argv;
while (microtime(true) < (float) $startAt) {
    usleep(1000);
}

try {
    DB::transaction(function () use ($orgId, $amount, $ref, $app) {
        $wallet = $app->make(WalletService::class);
        $wallet->lock($orgId);
        usleep(20000); // hold the lock a moment so the other processes really queue up behind it
        $wallet->debit(['organizationId' => $orgId, 'amount' => $amount, 'reason' => 'SMS_CHARGE', 'description' => 'race', 'referenceType' => 'race', 'referenceId' => $ref]);
    });
    echo 'ok';
} catch (AppException $e) {
    echo $e->errorCode->value === 'INSUFFICIENT_BALANCE' ? 'insufficient' : 'error:'.$e->getMessage();
} catch (Throwable $e) {
    echo 'error:'.$e->getMessage();
}
