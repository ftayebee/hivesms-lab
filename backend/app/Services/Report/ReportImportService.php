<?php

namespace App\Services\Report;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\Organization;
use App\Models\ReportImport;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SmsCostCalculator;
use App\Services\Wallet\WalletService;
use App\Support\Csv;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Report import (docs/24-report-import.md). A super admin uploads a CSV of SMS that were sent
 * outside this platform (another panel, the provider portal) and imports it into one customer's
 * message log, so the customer sees them in Reports, the message log and exports.
 *
 *  - Rows become messages with source IMPORT and a final status (DELIVERED, SUBMITTED, FAILED,
 *    REJECTED or EXPIRED). QUEUED is never written, so the worker can never send an imported row.
 *  - Cost per row: the "Cost" column when given, else segments × the customer's plan rate (failed
 *    rows cost nothing while the SMS policy refunds failed messages).
 *  - With "charge wallet", the total is debited from the customer's wallet once, as one SMS_CHARGE
 *    transaction referencing the import, in the same database transaction as the inserts: either
 *    everything is imported and charged, or nothing is.
 *  - The same file (SHA-256) can be imported into the same customer only once.
 */
class ReportImportService
{
    public const MAX_ROWS = 50000;

    private const MAX_BODY_CHARS = 2000;

    private const PREVIEW_ROWS = 20;

    private const MAX_ERRORS = 100;

    private const CHUNK = 500;

    /** Template / canonical columns → accepted header aliases (compared lower-case, spaces/_/- removed). */
    private const COLUMNS = [
        'sender' => ['senderid', 'sender', 'mask', 'masking', 'from', 'senderidmask'],
        'phone' => ['mobilenumber', 'mobile', 'phone', 'phonenumber', 'number', 'recipient', 'to', 'msisdn', 'mobileno', 'contact'],
        'message' => ['message', 'sms', 'smstext', 'text', 'body', 'content', 'messagetext'],
        'sentAt' => ['sentat', 'senttime', 'time', 'date', 'datetime', 'sentdate', 'createdat', 'submittime', 'sendtime'],
        'status' => ['status', 'deliverystatus', 'dlrstatus', 'dlr'],
        'smsType' => ['smstype', 'type', 'category'],
        'deliveredAt' => ['deliveredat', 'deliverytime', 'delivereddate'],
        'error' => ['error', 'errorreason', 'reason', 'failurereason', 'remarks', 'remark'],
        'reference' => ['reference', 'ref', 'clientreference', 'referenceid'],
        'cost' => ['cost', 'costbdt', 'price', 'charge', 'amount'],
    ];

    private const REQUIRED = ['sender' => 'Sender ID', 'phone' => 'Mobile Number', 'message' => 'Message', 'sentAt' => 'Sent At'];

    private const STATUS_ALIASES = [
        'DELIVERED' => ['delivered', 'deliver', 'success', 'successful', 'succeeded', 'delivrd', 'ok', 'done', 'complete', 'completed'],
        'SUBMITTED' => ['sent', 'submitted', 'accepted', 'pending', 'enroute', 'processing', 'submit'],
        'FAILED' => ['failed', 'fail', 'failure', 'undelivered', 'undeliverable', 'undeliv', 'error', 'unsuccessful'],
        'REJECTED' => ['rejected', 'reject', 'rejectd', 'blocked', 'dnd'],
        'EXPIRED' => ['expired', 'expire', 'timeout'],
    ];

    private const NOT_BILLED_WHEN_REFUNDING = ['FAILED', 'REJECTED', 'EXPIRED'];

    private const DATE_FORMATS = [
        'Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d g:i:s A', 'Y-m-d g:i A', 'Y-m-d',
        'Y/m/d H:i:s', 'Y/m/d H:i', 'Y/m/d g:i:s A', 'Y/m/d g:i A', 'Y/m/d',
        'd/m/Y H:i:s', 'd/m/Y H:i', 'd/m/Y g:i:s A', 'd/m/Y g:i A', 'd/m/Y',
        'd-m-Y H:i:s', 'd-m-Y H:i', 'd-m-Y g:i:s A', 'd-m-Y g:i A', 'd-m-Y',
        'd.m.Y H:i:s', 'd.m.Y H:i', 'd.m.Y',
        'd M Y H:i:s', 'd M Y H:i', 'd M Y g:i A', 'd M Y', 'd-M-Y H:i', 'd-M-Y', 'M d Y H:i', 'M d Y g:i A',
    ];

    public function __construct(
        private readonly SettingsService $settings,
        private readonly SmsCostCalculator $pricing,
        private readonly WalletService $wallet,
        private readonly AuditLogger $audit,
    ) {}

    // ─── Template ───

    /** Sample CSV (UTF-8 with BOM, so Excel shows Bangla correctly). */
    public static function templateCsv(): string
    {
        return Csv::bom()
            .Csv::line(['Sender ID', 'Mobile Number', 'Message', 'Sent At', 'Status', 'SMS Type', 'Delivered At', 'Error', 'Reference', 'Cost'])
            .Csv::line(['MZSMS', '01712345678', 'Your OTP is 482913. It expires in 5 minutes.', '2026-11-20 10:15:00', 'Delivered', 'Transactional', '2026-11-20 10:15:07', '', 'ORD-1001', ''])
            .Csv::line(['8809601000000', '01812345678', 'Eid offer: 20% off all items until Friday.', '20/11/2026 4:30 PM', 'Delivered', 'Promotional', '', '', '', '0.35'])
            .Csv::line(['MZSMS', '01912345678', 'আপনার অর্ডার পাঠানো হয়েছে। ধন্যবাদ।', '2026-11-21 09:00', 'Failed', 'Transactional', '', 'Handset unreachable', 'ORD-1002', ''])
            .Csv::line(['MZSMS', '01512345678', 'Your invoice INV-204 is due on 30 Nov.', '2026-11-21 11:45', 'Sent', '', '', '', '', '']);
    }

    // ─── Preview / import ───

    /** Validates the file against the customer and returns totals, sample rows and per-row problems. Writes nothing. */
    public function preview(string $organizationId, UploadedFile $file): array
    {
        $org = $this->organization($organizationId);
        ['raw' => $raw, 'name' => $name] = $this->readFile($file);
        $result = $this->evaluate($org, $raw);
        $previous = $this->previousImport($org->id, hash('sha256', $raw));
        $balance = $this->wallet->balance($org->id);

        return $this->summary($result, $name) + [
            'organization' => ['id' => $org->id, 'name' => $org->name],
            'balance' => Money::round($balance, 2),
            'sufficientBalance' => Money::cmp($balance, $result['totalCost']) >= 0,
            'alreadyImported' => $previous ? ['id' => $previous->id, 'createdAt' => Dhaka::iso($previous->createdAt), 'importedCount' => $previous->importedCount] : null,
            'rows' => array_slice($result['rows'], 0, self::PREVIEW_ROWS),
        ];
    }

    /**
     * Imports the valid rows (invalid ones are skipped and counted) and, when $charge is true,
     * debits the total from the wallet in the same transaction.
     *
     * @return array{import: ReportImport, summary: array<string, mixed>}
     */
    public function import(AdminContext $admin, string $organizationId, UploadedFile $file, bool $charge, ?string $note): array
    {
        $org = $this->organization($organizationId);
        ['raw' => $raw, 'name' => $name] = $this->readFile($file);
        $sha = hash('sha256', $raw);
        if ($prev = $this->previousImport($org->id, $sha)) {
            throw new AppException(ErrorCode::CONFLICT, 'This file was already imported for this customer on '.Dhaka::iso($prev->createdAt).'.', ['importId' => $prev->id]);
        }
        $result = $this->evaluate($org, $raw);
        if ($result['valid'] === 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'No row in this file can be imported. Fix the problems shown in the preview and try again.', ['field' => 'file']);
        }
        $charge = $charge && Money::isPositive($result['totalCost']);
        if ($charge) {
            $this->wallet->ensureWallet($org->id);
        }

        $id = (string) Str::uuid();
        try {
            $import = DB::transaction(function () use ($admin, $org, $result, $id, $name, $sha, $charge, $note) {
                $import = new ReportImport;
                $import->forceFill([
                    'id' => $id, 'organizationId' => $org->id, 'createdById' => $admin->userId, 'fileName' => $name, 'fileSha256' => $sha,
                    'rowCount' => $result['rowCount'], 'importedCount' => $result['valid'], 'skippedCount' => $result['skipped'],
                    'segments' => $result['segments'], 'totalCost' => $result['totalCost'], 'charged' => false,
                    'firstSentAt' => $result['firstSentAt'], 'lastSentAt' => $result['lastSentAt'],
                    'note' => $note !== null && $note !== '' ? mb_substr($note, 0, 500) : null,
                ])->save();

                $this->insertMessages($org->id, $id, $result['rows']);

                if ($charge) {
                    $this->wallet->lock($org->id);
                    $tx = $this->wallet->debit([
                        'organizationId' => $org->id, 'amount' => $result['totalCost'], 'reason' => 'SMS_CHARGE',
                        'description' => "Imported SMS report: {$result['valid']} messages ({$name})",
                        'referenceType' => 'report_import', 'referenceId' => $id, 'createdById' => $admin->userId,
                    ]);
                    $import->forceFill(['charged' => true, 'walletTransactionId' => $tx->id])->save();
                }

                $this->audit->log('admin.report.import', $admin->actor(), $org->id, 'report_import', $id, [
                    'fileName' => $name, 'rows' => $result['rowCount'], 'imported' => $result['valid'], 'skipped' => $result['skipped'],
                    'totalCost' => $result['totalCost'], 'charged' => $charge,
                ], $admin->ip, $admin->userAgent);

                return $import;
            });
        } catch (UniqueConstraintViolationException) {
            throw new AppException(ErrorCode::CONFLICT, 'This file was already imported for this customer.');
        }

        return ['import' => $import->fresh(['organization:id,name', 'createdBy:id,name']), 'summary' => $this->summary($result, $name)];
    }

    /** Imports, newest first (optionally one customer). */
    public function list(?string $organizationId, int $page): LengthAwarePaginator
    {
        return ReportImport::query()
            ->with(['organization:id,name', 'createdBy:id,name'])
            ->when($organizationId, fn ($q) => $q->where('organizationId', $organizationId))
            ->orderByDesc('createdAt')
            ->paginate(25, ['*'], 'page', $page);
    }

    // ─── Internals ───

    private function organization(string $id): Organization
    {
        return Organization::query()->find($id, ['id', 'name', 'pricingPlanId'])
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Customer not found.', ['field' => 'organizationId']);
    }

    private function previousImport(string $organizationId, string $sha): ?ReportImport
    {
        return ReportImport::query()->where('organizationId', $organizationId)->where('fileSha256', $sha)->first();
    }

    /** @return array{raw: string, name: string} */
    private function readFile(UploadedFile $file): array
    {
        $name = mb_substr(preg_replace('/[^\w.\- ]+/u', '_', $file->getClientOriginalName()) ?? 'report.csv', 0, 150);
        if (! in_array(strtolower($file->getClientOriginalExtension()), ['csv', 'txt'], true)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Upload a .csv file (Excel: File → Save As → CSV UTF-8).', ['field' => 'file']);
        }
        $size = (int) $file->getSize();
        if ($size === 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file is empty.', ['field' => 'file']);
        }
        if ($size > (int) config('smsflow.uploads.csv_max_bytes')) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'CSV files must be at most '.(int) (config('smsflow.uploads.csv_max_bytes') / 1048576).' MB.', ['field' => 'file']);
        }
        $raw = (string) file_get_contents($file->getRealPath());
        if (str_contains($raw, "\0")) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'This is not a text CSV file. Save the sheet as "CSV UTF-8" and upload that.', ['field' => 'file']);
        }
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;
        if (! mb_check_encoding($raw, 'UTF-8')) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file is not UTF-8. In Excel choose "CSV UTF-8 (Comma delimited)" so Bangla text survives.', ['field' => 'file']);
        }

        return ['raw' => $raw, 'name' => $name];
    }

    /**
     * Parses and validates every row.
     *
     * @return array{columns: array<string, string>, rowCount: int, valid: int, skipped: int, segments: int, totalCost: string, billable: int,
     *   byStatus: array<string, int>, firstSentAt: ?CarbonImmutable, lastSentAt: ?CarbonImmutable, rows: list<array<string, mixed>>, errors: list<array{line: int, reason: string}>}
     */
    public function evaluate(Organization $org, string $raw): array
    {
        ['headers' => $headers, 'rows' => $lines] = $this->parse($raw);
        $columns = $this->mapColumns($headers);
        $policy = $this->settings->smsPolicy();
        $refundFailed = (bool) ($policy['refundFailedMessages'] ?? true);
        $plan = $this->pricing->planFor($org->id);
        $rates = [];
        $latest = Dhaka::now()->addMinutes(10);
        $earliest = CarbonImmutable::create(2000, 1, 1, 0, 0, 0, 'UTC');

        $rows = $errors = [];
        $byStatus = [];
        $segmentsTotal = $billable = 0;
        $total = '0';
        $first = $last = null;
        $skipped = 0;

        foreach ($lines as ['line' => $line, 'cells' => $cells]) {
            $get = fn (string $key) => isset($columns[$key]) ? Csv::unescapeCell(trim((string) ($cells[$columns[$key]] ?? ''))) : '';
            try {
                $sender = $get('sender');
                if ($sender === '') {
                    throw new RowError('Sender ID is empty');
                }
                if (mb_strlen($sender) > 20) {
                    throw new RowError('Sender ID is longer than 20 characters');
                }
                $to = Phone::normalize($get('phone'));
                if ($to === null) {
                    throw new RowError('Mobile number "'.mb_substr($get('phone'), 0, 20).'" is not a valid Bangladesh mobile number');
                }
                $body = preg_replace('/\r\n?/', "\n", $get('message')) ?? '';
                $body = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', ' ', $body) ?? '';
                if (trim($body) === '') {
                    throw new RowError('Message is empty');
                }
                if (mb_strlen($body) > self::MAX_BODY_CHARS) {
                    throw new RowError('Message is longer than '.self::MAX_BODY_CHARS.' characters');
                }
                $sentAt = self::parseTime($get('sentAt'));
                if ($sentAt === null) {
                    throw new RowError('Sent At "'.mb_substr($get('sentAt'), 0, 30).'" is not a date and time (use YYYY-MM-DD HH:MM)');
                }
                if ($sentAt->greaterThan($latest) || $sentAt->lessThan($earliest)) {
                    throw new RowError('Sent At is in the future or before 2000');
                }
                $status = self::parseStatus($get('status'));
                if ($status === null) {
                    throw new RowError('Status "'.mb_substr($get('status'), 0, 20).'" is not one of Delivered, Sent, Failed, Rejected, Expired');
                }
                $smsType = self::parseSmsType($get('smsType'));
                if ($smsType === null) {
                    throw new RowError('SMS Type "'.mb_substr($get('smsType'), 0, 20).'" is not Transactional or Promotional');
                }
                $deliveredAt = null;
                if ($status === 'DELIVERED') {
                    $deliveredAt = $get('deliveredAt') !== '' ? self::parseTime($get('deliveredAt')) : $sentAt;
                    if ($deliveredAt === null) {
                        throw new RowError('Delivered At "'.mb_substr($get('deliveredAt'), 0, 30).'" is not a date and time');
                    }
                    if ($deliveredAt->lessThan($sentAt)) {
                        $deliveredAt = $sentAt;
                    }
                }
                $senderType = preg_match('/^\+?\d+$/', $sender) ? 'NON_MASKING' : 'MASKING';
                $seg = MessageSegmentCalculator::calculate($body, $policy['segmentation']);
                $segments = max(1, $seg['segments']);
                $rate = $rates["{$smsType}|{$senderType}"] ??= SmsCostCalculator::rateFor($plan, $smsType, $senderType);

                $costCell = str_replace([',', '৳', 'BDT', 'Tk', 'tk', ' '], '', $get('cost'));
                if ($costCell !== '') {
                    if (! is_numeric($costCell) || (float) $costCell < 0 || (float) $costCell > 10000) {
                        throw new RowError('Cost "'.mb_substr($get('cost'), 0, 20).'" is not an amount in BDT');
                    }
                    $cost = Money::round($costCell, 4);
                } elseif ($refundFailed && in_array($status, self::NOT_BILLED_WHEN_REFUNDING, true)) {
                    $cost = '0.0000';
                } else {
                    $cost = SmsCostCalculator::messageCost($segments, 1, $rate);
                }

                $reference = mb_substr($get('reference'), 0, 255);
                $error = mb_substr($get('error'), 0, 500);
                $rows[] = [
                    'line' => $line, 'to' => $to, 'operator' => Phone::operator($to), 'senderValue' => $sender, 'senderType' => $senderType,
                    'smsType' => $smsType, 'body' => $body, 'encoding' => $seg['encoding'], 'segments' => $segments, 'unitPrice' => $rate, 'cost' => $cost,
                    'status' => $status, 'sentAt' => Dhaka::iso($sentAt), 'deliveredAt' => $deliveredAt ? Dhaka::iso($deliveredAt) : null,
                    'errorMessage' => $error !== '' ? $error : null, 'clientReference' => $reference !== '' ? $reference : null,
                ];
                $byStatus[$status] = ($byStatus[$status] ?? 0) + 1;
                $segmentsTotal += $segments;
                $total = Money::add($total, $cost);
                $billable += Money::isPositive($cost) ? 1 : 0;
                $first = $first === null || $sentAt->lessThan($first) ? $sentAt : $first;
                $last = $last === null || $sentAt->greaterThan($last) ? $sentAt : $last;
            } catch (RowError $e) {
                $skipped++;
                if (count($errors) < self::MAX_ERRORS) {
                    $errors[] = ['line' => $line, 'reason' => $e->getMessage()];
                }
            }
        }

        return [
            'columns' => $columns, 'rowCount' => count($lines), 'valid' => count($rows), 'skipped' => $skipped, 'segments' => $segmentsTotal,
            'totalCost' => Money::round($total, 4), 'billable' => $billable, 'byStatus' => $byStatus, 'firstSentAt' => $first, 'lastSentAt' => $last,
            'rows' => $rows, 'errors' => $errors,
        ];
    }

    /** @return array<string, mixed> */
    private function summary(array $r, string $name): array
    {
        return [
            'fileName' => $name,
            'columns' => $r['columns'],
            'rowCount' => $r['rowCount'],
            'valid' => $r['valid'],
            'skipped' => $r['skipped'],
            'segments' => $r['segments'],
            'billable' => $r['billable'],
            'totalCost' => Money::round($r['totalCost'], 2),
            'byStatus' => (object) $r['byStatus'],
            'firstSentAt' => $r['firstSentAt'] ? Dhaka::iso($r['firstSentAt']) : null,
            'lastSentAt' => $r['lastSentAt'] ? Dhaka::iso($r['lastSentAt']) : null,
            'errors' => $r['errors'],
        ];
    }

    /** @param list<array<string, mixed>> $rows */
    private function insertMessages(string $organizationId, string $importId, array $rows): void
    {
        $now = now()->format('Y-m-d H:i:s.v');
        $fmt = fn (?string $iso) => $iso === null ? null : CarbonImmutable::parse($iso)->utc()->format('Y-m-d H:i:s.v');
        foreach (array_chunk($rows, self::CHUNK) as $chunk) {
            $messages = $events = [];
            foreach ($chunk as $r) {
                $id = (string) Str::uuid();
                $sent = $fmt($r['sentAt']);
                $final = in_array($r['status'], ['FAILED', 'REJECTED', 'EXPIRED'], true);
                $messages[] = [
                    'id' => $id, 'organizationId' => $organizationId, 'campaignId' => null, 'apiKeyId' => null, 'source' => 'IMPORT',
                    'to' => $r['to'], 'operator' => $r['operator'], 'senderValue' => $r['senderValue'], 'senderType' => $r['senderType'],
                    'smsType' => $r['smsType'], 'body' => $r['body'], 'encoding' => $r['encoding'], 'segments' => $r['segments'],
                    'unitPrice' => $r['unitPrice'], 'cost' => $r['cost'], 'status' => $r['status'], 'provider' => null,
                    'providerMessageId' => null, 'errorCode' => null, 'errorMessage' => $r['errorMessage'], 'clientReference' => $r['clientReference'],
                    'attempts' => 1, 'nextAttemptAt' => null, 'lockedUntil' => null, 'queuedAt' => $sent, 'submittedAt' => $sent,
                    'deliveredAt' => $fmt($r['deliveredAt']), 'failedAt' => $final ? $sent : null, 'refundedAt' => null,
                    'createdAt' => $sent, 'updatedAt' => $now,
                ];
                $events[] = [
                    'id' => (string) Str::uuid(), 'messageId' => $id, 'status' => $r['status'], 'providerStatus' => null,
                    'description' => "Imported from report (import {$importId}, line {$r['line']})", 'source' => 'SYSTEM',
                    'dedupeKey' => "import:{$id}", 'payload' => null, 'occurredAt' => $fmt($r['deliveredAt']) ?? $sent, 'receivedAt' => $now,
                ];
            }
            DB::table('messages')->insert($messages);
            DB::table('message_events')->insert($events);
        }
    }

    /**
     * CSV text → header list and rows keyed by header. Delimiter , ; or tab (from the header line);
     * quoted fields may contain newlines; empty rows are skipped.
     *
     * @return array{headers: list<string>, rows: list<array{line: int, cells: array<string, string>}>}
     */
    private function parse(string $raw): array
    {
        $firstLine = strtok($raw, "\n") ?: '';
        $counts = [',' => substr_count($firstLine, ','), ';' => substr_count($firstLine, ';'), "\t" => substr_count($firstLine, "\t")];
        arsort($counts);
        $delimiter = $counts[array_key_first($counts)] > 0 ? (string) array_key_first($counts) : ',';
        $fh = fopen('php://temp', 'r+b');
        fwrite($fh, $raw);
        rewind($fh);
        try {
            $head = fgetcsv($fh, null, $delimiter, '"', '');
            if ($head === false || $head === [null]) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has no header row.', ['field' => 'file']);
            }
            $headers = array_map(fn ($h) => mb_substr(trim(preg_replace('/\s+/u', ' ', (string) $h) ?? ''), 0, 64), $head);
            $rows = [];
            $line = 1;
            while (($cells = fgetcsv($fh, null, $delimiter, '"', '')) !== false) {
                $line++;
                if ($cells === [null] || count(array_filter($cells, fn ($v) => trim((string) $v) !== '')) === 0) {
                    continue;
                }
                if (count($rows) >= self::MAX_ROWS) {
                    throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has more than '.number_format(self::MAX_ROWS).' rows. Split it into smaller files.', ['field' => 'file']);
                }
                $assoc = [];
                foreach ($headers as $i => $h) {
                    if ($h !== '') {
                        $assoc[$h] = (string) ($cells[$i] ?? '');
                    }
                }
                $rows[] = ['line' => $line, 'cells' => $assoc];
            }
            if (! $rows) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has a header row but no data rows.', ['field' => 'file']);
            }

            return ['headers' => array_values(array_filter($headers, fn ($h) => $h !== '')), 'rows' => $rows];
        } finally {
            fclose($fh);
        }
    }

    /**
     * Matches file headers to the import columns by name (case, spaces, _ and - ignored).
     *
     * @param  list<string>  $headers
     * @return array<string, string> column key → header in the file
     */
    public function mapColumns(array $headers): array
    {
        $norm = fn (string $h) => preg_replace('/[\s_\-.\/()#]+/u', '', mb_strtolower($h)) ?? '';
        $byNorm = [];
        foreach ($headers as $h) {
            $byNorm[$norm($h)] ??= $h;
        }
        $out = [];
        foreach (self::COLUMNS as $key => $aliases) {
            foreach ($aliases as $alias) {
                if (isset($byNorm[$alias]) && ! in_array($byNorm[$alias], $out, true)) {
                    $out[$key] = $byNorm[$alias];
                    break;
                }
            }
        }
        $missing = array_values(array_diff_key(self::REQUIRED, $out));
        if ($missing) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file is missing the column'.(count($missing) > 1 ? 's ' : ' ').implode(', ', $missing).'. Download the template to see the expected columns.', ['field' => 'file']);
        }

        return $out;
    }

    /** Status cell → message status; empty means DELIVERED. */
    public static function parseStatus(string $v): ?string
    {
        $k = preg_replace('/[^a-z]/', '', strtolower($v)) ?? '';
        if ($k === '') {
            return 'DELIVERED';
        }
        foreach (self::STATUS_ALIASES as $status => $aliases) {
            if (in_array($k, $aliases, true)) {
                return $status;
            }
        }

        return null;
    }

    public static function parseSmsType(string $v): ?string
    {
        $k = strtolower(trim($v));

        return match (true) {
            $k === '' || str_starts_with($k, 'trans') || $k === 'otp' || $k === 'non-promotional' => 'TRANSACTIONAL',
            str_starts_with($k, 'promo') || $k === 'marketing' => 'PROMOTIONAL',
            default => null,
        };
    }

    /**
     * Date/time cell → UTC instant. Times without an offset are Asia/Dhaka. Accepts ISO-8601,
     * YYYY-MM-DD [HH:MM[:SS]], DD/MM/YYYY (also - and .) with 24-hour or AM/PM time, "20 Nov 2026 10:15",
     * and Excel serial numbers.
     */
    public static function parseTime(string $v): ?CarbonImmutable
    {
        $v = trim(preg_replace('/\s+/u', ' ', $v) ?? '');
        if ($v === '') {
            return null;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/', $v)) {
            try {
                return CarbonImmutable::parse($v)->utc();
            } catch (Throwable) {
                return null;
            }
        }
        if (is_numeric($v) && (float) $v > 20000 && (float) $v < 80000) {
            return CarbonImmutable::create(1899, 12, 30, 0, 0, 0, Dhaka::TZ)->addSeconds((int) round((float) $v * 86400))->utc();
        }
        $v = preg_replace('/^(\d{4}-\d{2}-\d{2})T/', '$1 ', $v) ?? $v;
        $v = preg_replace('/\.\d+$/', '', $v) ?? $v; // fractional seconds
        $tz = new DateTimeZone(Dhaka::TZ);
        foreach (self::DATE_FORMATS as $format) {
            $d = DateTimeImmutable::createFromFormat('!'.$format, $v, $tz);
            $errors = DateTimeImmutable::getLastErrors();
            if ($d !== false && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))) {
                return CarbonImmutable::instance($d)->utc();
            }
        }

        return null;
    }
}
