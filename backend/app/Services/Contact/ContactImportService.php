<?php

namespace App\Services\Contact;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Jobs\ProcessContactImportJob;
use App\Models\Contact;
use App\Services\Platform\AuditLogger;
use App\Support\Csv;
use App\Support\ErrorCode;
use App\Support\Phone;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * CSV contact import (port of importContacts in features/contacts/service.ts). Numbers are
 * validated and normalised; rows with the same number update the existing contact (fields present
 * in the file win); opted-out rows are added to the suppression list.
 *
 * Small files are imported in the request. Larger files are stored under a random name in the
 * private disk and processed by ProcessContactImportJob; progress is kept in the cache (the schema
 * has no import table) under an id that is only readable by the same organization.
 */
class ContactImportService
{
    private const HEADER_ALIASES = [
        'mobile' => 'phone', 'number' => 'phone', 'msisdn' => 'phone', 'phone_number' => 'phone', 'mobile_number' => 'phone',
        'full_name' => 'name', 'organisation' => 'company', 'organization' => 'company', 'consent_status' => 'consent',
    ];

    private const STANDARD = ['phone', 'name', 'email', 'company', 'tags', 'consent'];

    private const STATUS_TTL = 86400;

    public function __construct(private readonly ContactService $contacts, private readonly AuditLogger $audit) {}

    /**
     * @param  array{groupId: ?string, defaultConsent: string, consentSource: ?string}  $opts
     * @return array{importId: string, status: string, result?: array<string, mixed>}
     */
    public function start(TenantContext $ctx, UploadedFile $file, array $opts): array
    {
        $ctx->requirePermission('contacts:write');
        if ($opts['groupId']) {
            $this->contacts->assertGroupsOwned($ctx, [$opts['groupId']]);
        }
        $path = $file->getRealPath();
        $head = (string) file_get_contents($path, false, null, 0, 8192);
        if (str_contains($head, "\0")) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'This does not look like a text CSV file.', ['field' => 'file']);
        }
        $importId = (string) Str::uuid();

        if ($file->getSize() <= (int) config('smsflow.uploads.csv_sync_max_bytes')) {
            $result = $this->import($ctx, $path, $opts);

            return ['importId' => $importId, 'status' => 'completed', 'result' => $result];
        }

        // Never trust the client file name: stored under a random name, outside the web root.
        $stored = 'imports/'.$ctx->organizationId.'/'.$importId.'.csv';
        Storage::disk('local')->putFileAs(dirname($stored), $file, basename($stored));
        $this->setStatus($importId, ['organizationId' => $ctx->organizationId, 'status' => 'queued']);
        ProcessContactImportJob::dispatch($importId, $stored, [
            'organizationId' => $ctx->organizationId, 'organizationStatus' => $ctx->organizationStatus, 'userId' => $ctx->userId,
            'roleKey' => $ctx->roleKey, 'permissions' => $ctx->permissions, 'ip' => $ctx->ip,
        ], $opts);

        return ['importId' => $importId, 'status' => 'queued'];
    }

    /** @return array{importId: string, status: string, result?: mixed, error?: string} */
    public function status(TenantContext $ctx, string $importId): array
    {
        $ctx->requirePermission('contacts:read');
        $s = Cache::get("contact-import:{$importId}");
        if (! is_array($s) || ($s['organizationId'] ?? null) !== $ctx->organizationId) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Import not found.');
        }

        return ['importId' => $importId] + array_diff_key($s, ['organizationId' => true]);
    }

    public function setStatus(string $importId, array $status): void
    {
        Cache::put("contact-import:{$importId}", $status, self::STATUS_TTL);
    }

    /**
     * @param  array{groupId: ?string, defaultConsent: string, consentSource: ?string}  $opts
     * @return array{total: int, created: int, updated: int, invalid: list<array{row: int, value: string, reason: string}>, duplicates: int, suppressed: int}
     */
    public function import(TenantContext $ctx, string $path, array $opts): array
    {
        $ctx->requirePermission('contacts:write');
        $maxRows = (int) config('smsflow.uploads.csv_max_rows');
        $result = ['total' => 0, 'created' => 0, 'updated' => 0, 'invalid' => [], 'duplicates' => 0, 'suppressed' => 0];
        $byPhone = [];
        $now = now();
        $headers = [];

        $read = Csv::each($path, function (array $raw, int $line) use (&$byPhone, &$result, $opts, $now, $ctx) {
            $row = [];
            foreach ($raw as $k => $v) {
                $row[self::HEADER_ALIASES[$k] ?? $k] = Csv::unescapeCell((string) $v);
            }
            $phone = Phone::normalize($row['phone'] ?? null);
            if ($phone === null) {
                $result['invalid'][] = ['row' => $line, 'value' => mb_substr($row['phone'] ?? '', 0, 30), 'reason' => 'Not a valid Bangladesh mobile number'];

                return;
            }
            if (isset($byPhone[$phone])) {
                $result['duplicates']++;

                return;
            }
            $email = mb_strtolower(trim($row['email'] ?? '')) ?: null;
            $consentRaw = str_replace([' ', '-'], '_', strtoupper(trim($row['consent'] ?? '')));
            $consent = in_array($consentRaw, ['OPTED_IN', 'UNKNOWN', 'OPTED_OUT'], true) ? $consentRaw : $opts['defaultConsent'];
            $custom = [];
            foreach ($row as $k => $v) {
                if (! in_array($k, self::STANDARD, true) && $v !== '' && preg_match('/^[a-z][a-z0-9_]{0,39}$/', $k)) {
                    $custom[$k] = mb_substr($v, 0, 500);
                }
            }
            $tags = array_values(array_unique(array_slice(array_filter(array_map(
                fn ($t) => preg_replace('/\s+/', '-', mb_strtolower(trim($t))),
                preg_split('/[,;|]/', $row['tags'] ?? '') ?: [],
            ), fn ($t) => $t !== ''), 0, 20)));
            $byPhone[$phone] = [
                'organizationId' => $ctx->organizationId,
                'phone' => $phone,
                'name' => mb_substr(trim($row['name'] ?? ''), 0, 120) ?: null,
                'email' => $email && filter_var($email, FILTER_VALIDATE_EMAIL) ? mb_substr($email, 0, 254) : null,
                'company' => mb_substr(trim($row['company'] ?? ''), 0, 120) ?: null,
                'tags' => $tags,
                'customFields' => $custom,
                'consentStatus' => $consent,
                'consentSource' => $opts['consentSource'] ?: 'CSV import',
                'consentAt' => $consent !== 'UNKNOWN' ? $now : null,
            ];
        }, $maxRows, $headers);

        $headers = array_map(fn ($h) => self::HEADER_ALIASES[$h] ?? $h, $headers);
        if (! in_array('phone', $headers, true)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file needs a column named phone (or mobile / number).', ['field' => 'file']);
        }
        if ($read === 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has no data rows.', ['field' => 'file']);
        }
        if ($read > $maxRows) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Import at most '.number_format($maxRows).' rows per file.', ['field' => 'file']);
        }
        $result['total'] = $read;

        foreach (array_chunk(array_values($byPhone), 2000) as $chunk) {
            DB::transaction(function () use ($chunk, $ctx, $opts, &$result) {
                $phones = array_column($chunk, 'phone');
                $existing = Contact::withTrashed()->where('organizationId', $ctx->organizationId)->whereIn('phone', $phones)->pluck('id', 'phone');
                $ts = now()->format('Y-m-d H:i:s.v');
                $toCreate = [];
                foreach ($chunk as $r) {
                    if (isset($existing[$r['phone']])) {
                        $update = ['deletedAt' => null, 'consentStatus' => $r['consentStatus'], 'consentAt' => $r['consentAt']?->format('Y-m-d H:i:s.v'), 'consentSource' => $r['consentSource']];
                        foreach (['name', 'email', 'company'] as $k) {
                            if ($r[$k]) {
                                $update[$k] = $r[$k];
                            }
                        }
                        if ($r['tags']) {
                            $update['tags'] = json_encode($r['tags'], JSON_UNESCAPED_UNICODE);
                        }
                        if ($r['customFields']) {
                            $update['customFields'] = json_encode($r['customFields'], JSON_UNESCAPED_UNICODE);
                        }
                        Contact::withTrashed()->whereKey($existing[$r['phone']])->update($update);
                    } else {
                        $toCreate[] = [
                            'id' => (string) Str::uuid(), 'organizationId' => $r['organizationId'], 'phone' => $r['phone'], 'name' => $r['name'],
                            'email' => $r['email'], 'company' => $r['company'], 'tags' => json_encode($r['tags'], JSON_UNESCAPED_UNICODE),
                            'customFields' => json_encode((object) $r['customFields'], JSON_UNESCAPED_UNICODE), 'consentStatus' => $r['consentStatus'],
                            'consentSource' => $r['consentSource'], 'consentAt' => $r['consentAt']?->format('Y-m-d H:i:s.v'), 'createdAt' => $ts, 'updatedAt' => $ts,
                        ];
                    }
                }
                if ($toCreate) {
                    DB::table('contacts')->insertOrIgnore($toCreate);
                }
                $result['created'] += count($toCreate);
                $result['updated'] += count($chunk) - count($toCreate);
                if ($opts['groupId']) {
                    $ids = Contact::query()->where('organizationId', $ctx->organizationId)->whereIn('phone', $phones)->pluck('id');
                    DB::table('contact_group_members')->insertOrIgnore($ids->map(fn ($id) => ['groupId' => $opts['groupId'], 'contactId' => $id, 'addedAt' => $ts])->all());
                }
                $optedOut = array_filter($chunk, fn ($r) => $r['consentStatus'] === 'OPTED_OUT');
                if ($optedOut) {
                    $result['suppressed'] += DB::table('suppression_entries')->insertOrIgnore(array_values(array_map(fn ($r) => [
                        'id' => (string) Str::uuid(), 'organizationId' => $ctx->organizationId, 'phone' => $r['phone'], 'reason' => 'OPT_OUT', 'source' => 'CSV import', 'createdAt' => $ts,
                    ], $optedOut)));
                }
            });
        }

        $this->audit->log('contact.import', $ctx->actor(), $ctx->organizationId, metadata: [
            'total' => $result['total'], 'created' => $result['created'], 'updated' => $result['updated'],
            'invalid' => count($result['invalid']), 'duplicates' => $result['duplicates'],
        ]);
        $result['invalid'] = array_slice($result['invalid'], 0, 200);

        return $result;
    }

    /** Runs a stored import (from the job), recording progress; always deletes the file. */
    public function runStored(string $importId, string $storedPath, TenantContext $ctx, array $opts): void
    {
        $this->setStatus($importId, ['organizationId' => $ctx->organizationId, 'status' => 'processing']);
        try {
            $result = $this->import($ctx, Storage::disk('local')->path($storedPath), $opts);
            $this->setStatus($importId, ['organizationId' => $ctx->organizationId, 'status' => 'completed', 'result' => $result]);
        } catch (AppException $e) {
            $this->setStatus($importId, ['organizationId' => $ctx->organizationId, 'status' => 'failed', 'error' => $e->getMessage()]);
        } catch (Throwable $e) {
            $this->setStatus($importId, ['organizationId' => $ctx->organizationId, 'status' => 'failed', 'error' => 'The import could not be completed. Try again or contact support.']);
            throw $e;
        } finally {
            Storage::disk('local')->delete($storedPath);
        }
    }
}
