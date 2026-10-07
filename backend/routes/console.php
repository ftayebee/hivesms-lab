<?php

use App\Services\Messaging\WorkerService;
use App\Services\Platform\SchemaInspector;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;

/*
|--------------------------------------------------------------------------
| Background work
|--------------------------------------------------------------------------
| Production cron (one entry, every minute):
|   * * * * * cd /path/to/backend && php artisan schedule:run >> /dev/null 2>&1
|
| withoutOverlapping() + onOneServer() (cache locks) prevent duplicate execution even if the cron
| fires twice or several servers share the database; the underlying claims are atomic anyway.
*/

Artisan::command('sms:work {--budget=}', function (WorkerService $worker) {
    $budget = $this->option('budget') !== null ? (int) $this->option('budget') : (int) config('smsflow.sms.worker_budget_seconds');
    $summary = $worker->tick(budgetSeconds: $budget);
    $this->line(json_encode($summary));
})->purpose('One worker cycle: launch due campaigns, send queued SMS, poll delivery, finalise campaigns, deliver customer webhooks');

Artisan::command('app:housekeeping', function (WorkerService $worker) {
    $this->line(json_encode($worker->housekeeping()));
})->purpose('Expire stale payments, purge expired sessions, rate-limit buckets, idempotency keys and old tokens');

/*
|--------------------------------------------------------------------------
| Deployment checks (read-only)
|--------------------------------------------------------------------------
| Run on the server before and after every deployment; see deploy/hostinger.sh.
*/

Artisan::command('app:schema-check {--save= : also write the snapshot to this JSON file} {--write-expected : regenerate database/schema/expected-schema.json (never in production)}', function (SchemaInspector $inspector) {
    $snapshot = $inspector->snapshot();
    if ($this->option('save')) {
        file_put_contents($this->option('save'), json_encode($snapshot, JSON_PRETTY_PRINT));
    }
    if ($this->option('write-expected')) {
        if (app()->isProduction()) {
            $this->error('Refusing to rewrite the expected schema from a production database.');

            return 1;
        }
        file_put_contents(database_path(SchemaInspector::EXPECTED_FILE), json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
        $this->info('Expected schema written ('.count($snapshot['tables']).' tables).');

        return 0;
    }
    $count = fn (array $s, string $k) => array_sum(array_map(fn ($t) => count($t[$k]), $s['tables']));
    $expected = $inspector->expected();
    $this->table(['', 'tables', 'columns', 'indexes', 'foreign keys', 'fingerprint'], [
        ['expected', count($expected['tables']), $count($expected, 'columns'), $count($expected, 'indexes'), $count($expected, 'fks'), substr(SchemaInspector::fingerprint($expected), 0, 16)],
        ['database', count($snapshot['tables']), $count($snapshot, 'columns'), $count($snapshot, 'indexes'), $count($snapshot, 'fks'), substr(SchemaInspector::fingerprint($snapshot), 0, 16)],
    ]);
    $diff = SchemaInspector::diff($expected, $snapshot);
    if ($diff) {
        $this->error(count($diff).' difference(s) from the expected application schema:');
        foreach ($diff as $line) {
            $this->line('  '.$line);
        }

        return 1;
    }
    $this->info('Application schema matches the expected baseline exactly.');

    return 0;
})->purpose('Read-only: compare the 42 application tables (columns, indexes, foreign keys) with the expected baseline');

Artisan::command('app:deploy-check', function () {
    $rows = [];
    $failed = false;
    $check = function (string $name, bool|string $result, string $detail = '') use (&$rows, &$failed) {
        $ok = $result === true || $result === 'ok';
        $warn = $result === 'warn';
        $failed = $failed || (! $ok && ! $warn);
        $rows[] = [$ok ? 'OK' : ($warn ? 'WARN' : 'FAIL'), $name, $detail];
    };
    // Fingerprints compare secrets with the Next.js values without revealing them; same formula in Node:
    // node -e "console.log(require('crypto').createHash('sha256').update('smsflow-fp:'+process.env.AUTH_SECRET).digest('hex').slice(0,12))"
    $fp = fn (string $v) => $v === '' ? '(empty)' : 'len '.strlen($v).', fp '.substr(hash('sha256', 'smsflow-fp:'.$v), 0, 12);

    $check('PHP >= 8.2', version_compare(PHP_VERSION, '8.2.0', '>='), PHP_VERSION.' at '.PHP_BINARY);
    foreach (['pdo_mysql', 'openssl', 'mbstring', 'bcmath', 'ctype', 'fileinfo', 'tokenizer', 'curl'] as $ext) {
        $check("ext-{$ext}", extension_loaded($ext));
    }
    $check('argon2id (existing passwords)', defined('PASSWORD_ARGON2ID') && str_starts_with((string) @password_hash('x', PASSWORD_ARGON2ID), '$argon2id$'));
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    $check('proc_open (scheduler runInBackground)', function_exists('proc_open') && ! in_array('proc_open', $disabled, true) ? true : 'warn', 'if missing, remove ->runInBackground() in routes/console.php');
    $check('memory_limit', 'ok', (string) ini_get('memory_limit'));

    $check('APP_ENV=production', app()->isProduction(), (string) app()->environment());
    $check('APP_DEBUG=false', ! config('app.debug'));
    $check('APP_KEY set', (string) config('app.key') !== '', 'not used for application data');
    $check('APP_URL https', str_starts_with((string) config('app.url'), 'https://'), (string) config('app.url'));
    $check('FRONTEND_URL https', str_starts_with((string) config('smsflow.frontend_url'), 'https://'), (string) config('smsflow.frontend_url'));
    foreach (['auth_secret' => 'AUTH_SECRET', 'api_key_pepper' => 'API_KEY_PEPPER', 'settings_encryption_key' => 'SETTINGS_ENCRYPTION_KEY', 'frontend_proxy_secret' => 'FRONTEND_PROXY_SECRET', 'cron_secret' => 'CRON_SECRET'] as $key => $env) {
        $v = (string) config("smsflow.{$key}");
        $check($env, strlen($v) >= ($key === 'cron_secret' ? 16 : 32), $fp($v));
    }
    $check('SESSION_DRIVER != database', config('session.driver') !== 'database', (string) config('session.driver'));
    $check('CACHE_STORE', 'ok', (string) config('cache.default'));
    $check('QUEUE_CONNECTION', 'ok', (string) config('queue.default'));
    $check('SMS_PROVIDER not mock', config('smsflow.sms.provider') !== 'mock' ? true : 'warn', (string) config('smsflow.sms.provider').' (Admin settings may override)');
    $check('mock payments off', ! config('smsflow.features.allow_mock_payments'));

    try {
        $check('database connection', true, DB::selectOne('SELECT VERSION() v')->v.' / '.DB::connection()->getDatabaseName());
        $tables = array_column(DB::select('SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'), 't');
        $app = array_diff($tables, SchemaInspector::LARAVEL_TABLES);
        $check('42 application tables', count($app) === 42, count($app).' found');
        $missing = array_diff(['migrations', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs'], $tables);
        $check('Laravel tables', $missing ? 'warn' : true, $missing ? 'missing: '.implode(', ', $missing).' (created by `migrate`, additive only)' : 'present');
        $check('existing data readable', true, DB::table('users')->count().' users, '.DB::table('organizations')->count().' organizations');
    } catch (Throwable $e) {
        // SQLSTATE + driver message only; the DSN and password are never part of it.
        $check('database connection', false, preg_replace("/'[^']*'@'[^']*'/", "'<user>'@'<host>'", mb_substr($e->getMessage(), 0, 300)));
    }

    foreach (['storage/logs', 'storage/framework/cache', 'storage/framework/views', 'storage/app/private', 'bootstrap/cache'] as $dir) {
        $check("writable {$dir}", is_dir(base_path($dir)) && is_writable(base_path($dir)));
    }
    try {
        Log::info('deploy-check: log write test');
        $check('log write', true, (string) config('logging.default'));
    } catch (Throwable $e) {
        $check('log write', false, mb_substr($e->getMessage(), 0, 200));
    }
    $this->table(['', 'check', 'detail'], $rows);

    return $failed ? 1 : 0;
})->purpose('Read-only deployment preflight: PHP, extensions, env, secrets (fingerprints only), database, storage');

// SMS pipeline: every minute, bounded by a time budget so runs never pile up.
Schedule::command('sms:work')->everyMinute()->withoutOverlapping(5)->onOneServer()->runInBackground();

// Queued jobs (campaign launch, inline dispatch fallback, emails, CSV imports) on hosts without a
// supervisor: drain the database queue each minute. On a VPS run `php artisan queue:work` under
// Supervisor/systemd instead and set QUEUE_WORKER_VIA_SCHEDULER=false.
if (config('smsflow.queue_worker_via_scheduler')) {
    Schedule::command('queue:work --stop-when-empty --max-time=55 --tries=3 --timeout=50')->everyMinute()->withoutOverlapping(5)->onOneServer()->runInBackground();
}

Schedule::command('app:housekeeping')->everyTenMinutes()->withoutOverlapping()->onOneServer();
Schedule::command('queue:prune-failed --hours=720')->daily();
