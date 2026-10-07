<?php

namespace App\Jobs;

use App\Auth\TenantContext;
use App\Services\Contact\ContactImportService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Imports a large contact CSV in the background. The import is idempotent (contacts are keyed by
 * (organizationId, phone)), so re-uploading the same file after a failure is harmless. The
 * temporary file is deleted after the run, and on final failure.
 */
class ProcessContactImportJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    /** One attempt: the temporary file is removed after the run; the customer can simply re-upload. */
    public int $tries = 1;

    public int $timeout = 600;

    /**
     * @param  array{organizationId: string, organizationStatus: string, userId: ?string, roleKey: ?string, permissions: list<string>, ip: ?string}  $context
     * @param  array{groupId: ?string, defaultConsent: string, consentSource: ?string}  $opts
     */
    public function __construct(
        public readonly string $importId,
        public readonly string $storedPath,
        public readonly array $context,
        public readonly array $opts,
    ) {}

    public function handle(ContactImportService $imports): void
    {
        $c = $this->context;
        $ctx = new TenantContext($c['organizationId'], $c['organizationStatus'], $c['userId'], null, $c['roleKey'], $c['permissions'], $c['ip']);
        $imports->runStored($this->importId, $this->storedPath, $ctx, $this->opts);
    }

    public function failed(?Throwable $e): void
    {
        Storage::disk('local')->delete($this->storedPath);
        app(ContactImportService::class)->setStatus($this->importId, [
            'organizationId' => $this->context['organizationId'],
            'status' => 'failed',
            'error' => 'The import could not be completed. Try again or contact support.',
        ]);
    }
}
