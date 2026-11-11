<?php

namespace App\Services\Campaign;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\BlocklistEntry;
use App\Models\Campaign;
use App\Models\CampaignUpload;
use App\Models\Contact;
use App\Models\Organization;
use App\Models\SenderId;
use App\Services\Messaging\ComplianceService;
use App\Services\Messaging\RiskEvaluator;
use App\Services\Messaging\SendService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SmsCostCalculator;
use App\Services\Sms\SmsProviderManager;
use App\Services\Wallet\WalletService;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Dynamic SMS: one personalised message per CSV row (docs/20, docs/21).
 *
 *  1. upload()   stores the CSV privately (orgs/<org>/dynamic-sms/<uuid>.csv), detects the
 *                header row and returns a preview. Upload ids are tenant-scoped: another
 *                organization's id is "not found".
 *  2. mapping    the customer picks the recipient column (required) and optionally a sender ID
 *                column. Both are removed from the personalisation fields.
 *  3. template   {{Column Name}} placeholders; only the remaining columns are valid. Unknown
 *                placeholders are rejected, never rendered as empty text.
 *  4. rows       each row is rendered on its own (no shared state between rows). A row whose phone
 *                is invalid, whose sender is not approved for this organization, or that lacks a
 *                value for a used placeholder is skipped and counted — never sent with a guess.
 *                missingValues = "reject" blocks the whole submission instead.
 *  5. submit     validates everything again, checks balance and risk, creates the campaign
 *                (kind DYNAMIC) and marks the upload used (once: a second submit of the same
 *                upload is a conflict).
 *  6. launch     CampaignRunner calls materialize() to re-read the file at launch time (sender
 *                approvals and opt-outs may have changed), then charges once and queues messages.
 *                The rendered text is stored in messages.body, the row's values in
 *                campaign_recipients.variables and the template in campaigns.message.
 */
class DynamicSmsService
{
    public const PREVIEW_ROWS = 20;

    private const UPLOAD_TTL_HOURS = 24;

    private const MAX_HEADERS = 50;

    private const MAX_VALUE_CHARS = 500;

    private const PLACEHOLDER = '/\{\{\s*([^{}]{1,64}?)\s*\}\}/u';

    public function __construct(
        private readonly SettingsService $settings,
        private readonly ComplianceService $compliance,
        private readonly SendService $send,
        private readonly SmsCostCalculator $pricing,
        private readonly WalletService $wallet,
        private readonly RiskEvaluator $risk,
        private readonly AuditLogger $audit,
        private readonly CampaignService $campaigns,
    ) {}

    private function disk(): Filesystem
    {
        return Storage::disk((string) config('smsflow.uploads.disk', 'local'));
    }

    // ─── Upload ───

    /** @return array<string, mixed> */
    public function upload(TenantContext $ctx, UploadedFile $file): array
    {
        $ctx->requirePermission(['campaigns:write', 'sms:send']);
        $ctx->assertActive();
        $name = mb_substr(preg_replace('/[^\w.\- ]+/u', '_', $file->getClientOriginalName()) ?? 'upload.csv', 0, 120);
        $ext = strtolower($file->getClientOriginalExtension());
        if (! in_array($ext, ['csv', 'txt'], true)) {
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
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw; // UTF-8 BOM
        if (! mb_check_encoding($raw, 'UTF-8')) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file is not UTF-8. In Excel choose "CSV UTF-8 (Comma delimited)" so Bangla text survives.', ['field' => 'file']);
        }
        $parsed = $this->parse($raw, $this->settings->campaignProcessing()['maxDynamicRows']);

        $id = (string) Str::uuid();
        $key = "orgs/{$ctx->organizationId}/dynamic-sms/{$id}.csv";
        $this->disk()->put($key, $raw);
        $upload = new CampaignUpload;
        $upload->forceFill([
            'id' => $id, 'organizationId' => $ctx->organizationId, 'createdById' => $ctx->userId, 'fileKey' => $key, 'fileName' => $name,
            'sizeBytes' => $size, 'headers' => $parsed['headers'], 'rowCount' => $parsed['rowCount'], 'status' => 'READY',
            'expiresAt' => now()->addHours(self::UPLOAD_TTL_HOURS),
        ])->save();
        $this->audit->log('dynamic_sms.upload', $ctx->actor(), $ctx->organizationId, 'campaign_upload', $id, ['rows' => $parsed['rowCount'], 'bytes' => $size]);

        return $this->describe($upload, $parsed);
    }

    public function owned(TenantContext $ctx, string $id): CampaignUpload
    {
        $ctx->requirePermission('campaigns:read');

        return CampaignUpload::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Upload not found. Upload the file again.');
    }

    /** @return array<string, mixed> */
    public function show(TenantContext $ctx, string $id): array
    {
        $u = $this->owned($ctx, $id);

        return $this->describe($u, $this->parse($this->read($u), PHP_INT_MAX));
    }

    /** @return array<string, mixed> */
    private function describe(CampaignUpload $u, array $parsed): array
    {
        return [
            'id' => $u->id,
            'fileName' => $u->fileName,
            'sizeBytes' => $u->sizeBytes,
            'headers' => $parsed['headers'],
            'rowCount' => $parsed['rowCount'],
            'emptyRows' => $parsed['emptyRows'],
            'malformedRows' => $parsed['malformedRows'],
            'preview' => array_slice($parsed['rows'], 0, self::PREVIEW_ROWS),
            'suggestedRecipientColumn' => $this->guessPhoneColumn($parsed),
            'suggestedSenderColumn' => $this->firstHeaderMatching($parsed['headers'], '/^(sender|sender[ _-]?id|mask|masking)$/i'),
            'status' => $u->status,
            'expiresAt' => Dhaka::iso($u->expiresAt),
        ];
    }

    private function read(CampaignUpload $u): string
    {
        if (str_contains($u->fileKey, '..') || ! $this->disk()->exists($u->fileKey)) {
            throw new AppException(ErrorCode::CONFLICT, 'The uploaded file is no longer available. Upload it again.');
        }

        return (string) $this->disk()->get($u->fileKey);
    }

    /**
     * Parses CSV text: delimiter , ; or tab (from the header line), quoted fields with embedded
     * newlines, empty rows skipped and counted. A row with more cells than headers is malformed.
     *
     * @return array{headers: list<string>, rows: list<array{line: int, cells: array<string, string>, malformed: bool}>, rowCount: int, emptyRows: int, malformedRows: int}
     */
    public function parse(string $raw, int $maxRows): array
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;
        $firstLine = strtok($raw, "\n") ?: '';
        $counts = [',' => substr_count($firstLine, ','), ';' => substr_count($firstLine, ';'), "\t" => substr_count($firstLine, "\t")];
        arsort($counts);
        $delimiter = (string) array_key_first($counts);
        if ($counts[$delimiter] === 0) {
            $delimiter = ',';
        }
        $fh = fopen('php://temp', 'r+b');
        fwrite($fh, $raw);
        rewind($fh);
        try {
            $head = fgetcsv($fh, null, $delimiter, '"', '');
            if ($head === false || $head === [null]) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has no header row.', ['field' => 'file']);
            }
            $headers = array_map(fn ($h) => trim(preg_replace('/\s+/u', ' ', (string) $h) ?? ''), $head);
            while ($headers && end($headers) === '') {
                array_pop($headers); // trailing empty columns (Excel)
            }
            $this->assertHeaders($headers);

            $rows = [];
            $empty = $malformed = 0;
            $line = 1;
            while (($cells = fgetcsv($fh, null, $delimiter, '"', '')) !== false) {
                $line++;
                if ($cells === [null] || count(array_filter($cells, fn ($v) => trim((string) $v) !== '')) === 0) {
                    $empty++;

                    continue;
                }
                if (count($rows) >= $maxRows) {
                    throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has more than '.number_format($maxRows).' rows. Split it into smaller files.', ['field' => 'file']);
                }
                $extra = array_filter(array_slice($cells, count($headers)), fn ($v) => trim((string) $v) !== '');
                $assoc = [];
                foreach ($headers as $i => $h) {
                    $assoc[$h] = self::cleanValue((string) ($cells[$i] ?? ''));
                }
                $isMalformed = (bool) $extra;
                $malformed += (int) $isMalformed;
                $rows[] = ['line' => $line, 'cells' => $assoc, 'malformed' => $isMalformed];
            }
            if (! $rows) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has a header row but no data rows.', ['field' => 'file']);
            }

            return ['headers' => array_values($headers), 'rows' => $rows, 'rowCount' => count($rows), 'emptyRows' => $empty, 'malformedRows' => $malformed];
        } finally {
            fclose($fh);
        }
    }

    /** @param list<string> $headers */
    private function assertHeaders(array $headers): void
    {
        if (count($headers) < 1) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has no columns.', ['field' => 'file']);
        }
        if (count($headers) > self::MAX_HEADERS) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The file has more than '.self::MAX_HEADERS.' columns.', ['field' => 'file']);
        }
        $seen = [];
        foreach ($headers as $i => $h) {
            if ($h === '') {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Column '.($i + 1).' has no header. Give every column a name in the first row.', ['field' => 'file']);
            }
            if (mb_strlen($h) > 64 || preg_match('/[{}]/', $h) || ! preg_match('/^[\p{L}\p{M}\p{N} _.\-\/#()&]+$/u', $h)) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Column header "'.mb_substr($h, 0, 40).'" is not allowed. Use letters, numbers, spaces and - _ . / # ( ) & only (max 64).', ['field' => 'file']);
            }
            $k = mb_strtolower($h);
            if (isset($seen[$k])) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, "Two columns are named \"{$h}\". Column headers must be unique.", ['field' => 'file']);
            }
            $seen[$k] = true;
        }
    }

    /** CSV values are untrusted: control characters (incl. line breaks) become spaces; length capped. */
    public static function cleanValue(string $v): string
    {
        $v = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v) ?? '';

        return mb_substr(trim($v), 0, self::MAX_VALUE_CHARS);
    }

    private function guessPhoneColumn(array $parsed): ?string
    {
        $byName = $this->firstHeaderMatching($parsed['headers'], '/(phone|mobile|msisdn|number|contact|cell|মোবাইল|ফোন|নম্বর)/iu');
        if ($byName) {
            return $byName;
        }
        $sample = array_slice($parsed['rows'], 0, 20);
        foreach ($parsed['headers'] as $h) {
            $valid = count(array_filter($sample, fn ($r) => Phone::normalize($r['cells'][$h] ?? '') !== null));
            if ($sample && $valid >= max(1, (int) ceil(count($sample) * 0.6))) {
                return $h;
            }
        }

        return null;
    }

    private function firstHeaderMatching(array $headers, string $re): ?string
    {
        foreach ($headers as $h) {
            if (preg_match($re, $h)) {
                return $h;
            }
        }

        return null;
    }

    // ─── Mapping, template and rendering ───

    /**
     * @param  array{recipientColumn?: ?string, senderColumn?: ?string}  $mapping
     * @return array{recipientColumn: string, senderColumn: ?string, fields: list<string>}
     */
    public function resolveMapping(array $headers, array $mapping): array
    {
        $recipient = (string) ($mapping['recipientColumn'] ?? '');
        if ($recipient === '' || ! in_array($recipient, $headers, true)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Choose the column that holds the recipient mobile numbers.', ['field' => 'recipientColumn']);
        }
        $sender = ($mapping['senderColumn'] ?? '') !== '' ? (string) $mapping['senderColumn'] : null;
        if ($sender !== null && (! in_array($sender, $headers, true) || $sender === $recipient)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Choose a different column for the sender ID.', ['field' => 'senderColumn']);
        }

        return [
            'recipientColumn' => $recipient,
            'senderColumn' => $sender,
            // The recipient and sender columns are never personalisation fields.
            'fields' => array_values(array_filter($headers, fn ($h) => $h !== $recipient && $h !== $sender)),
        ];
    }

    /**
     * Placeholders of the template, resolved to field names (case-insensitive). Unknown names are
     * rejected — including the recipient and sender columns.
     *
     * @param  list<string>  $fields
     * @return list<string> canonical field names used
     */
    public function templateFields(string $template, array $fields, array $excluded = []): array
    {
        $byLower = [];
        foreach ($fields as $f) {
            $byLower[mb_strtolower($f)] = $f;
        }
        preg_match_all(self::PLACEHOLDER, $template, $m);
        $used = [];
        $unknown = [];
        foreach ($m[1] as $name) {
            $k = mb_strtolower(trim($name));
            if (isset($byLower[$k])) {
                $used[$byLower[$k]] = true;
            } else {
                $unknown[] = trim($name);
            }
        }
        if ($unknown) {
            $excludedHit = array_values(array_intersect(array_map('mb_strtolower', $unknown), array_map('mb_strtolower', array_filter($excluded))));
            throw new AppException(ErrorCode::VALIDATION_ERROR, $excludedHit
                ? 'The recipient number and sender ID columns cannot be used inside the message.'
                : 'Unknown field '.implode(', ', array_map(fn ($u) => '{{'.$u.'}}', array_unique($unknown))).'. Use one of the listed columns.', ['field' => 'message', 'unknown' => array_values(array_unique($unknown))]);
        }
        if (preg_match('/\{\{|\}\}/', preg_replace(self::PLACEHOLDER, '', $template) ?? '')) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The message has an unfinished {{field}} placeholder.', ['field' => 'message']);
        }

        return array_keys($used);
    }

    /**
     * Renders one row. Values come only from that row. Returns the text and the fields that had
     * no value (the caller skips or rejects such rows; nothing is substituted).
     *
     * @param  array<string, string>  $cells
     * @param  list<string>  $fields
     * @return array{body: string, missing: list<string>}
     */
    public function render(string $template, array $cells, array $fields): array
    {
        $byLower = [];
        foreach ($fields as $f) {
            $byLower[mb_strtolower($f)] = $f;
        }
        $missing = [];
        $body = preg_replace_callback(self::PLACEHOLDER, function ($m) use ($byLower, $cells, &$missing) {
            $field = $byLower[mb_strtolower(trim($m[1]))] ?? null;
            $value = $field !== null ? ($cells[$field] ?? '') : '';
            if ($value === '') {
                $missing[] = $field ?? trim($m[1]);
            }

            return $value;
        }, $template) ?? $template;

        return ['body' => $body, 'missing' => array_values(array_unique($missing))];
    }

    /**
     * Evaluates every row of an upload for a mapping + template. Row-by-row, no shared state.
     *
     * @return array{rows: list<array<string, mixed>>, stats: array<string, mixed>}
     */
    public function evaluate(string $organizationId, CampaignUpload $upload, array $input, ?array $parsed = null): array
    {
        $parsed ??= $this->parse($this->read($upload), PHP_INT_MAX);
        $map = $this->resolveMapping($parsed['headers'], $input);
        $template = (string) ($input['message'] ?? '');
        if (trim($template) === '') {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Write a message.', ['field' => 'message']);
        }
        $used = $this->templateFields($template, $map['fields'], [$map['recipientColumn'], $map['senderColumn']]);
        $smsType = (string) ($input['smsType'] ?? 'TRANSACTIONAL');
        $policy = $this->settings->smsPolicy();
        $optOut = $smsType === 'PROMOTIONAL' && $policy['appendOptOutText'] ? "\n".$policy['promotionalOptOutText'] : '';

        // Sender: per-row column (validated against this organization's APPROVED sender IDs) or the composer's choice.
        $defaultSender = $this->send->resolveSender($organizationId, ($input['senderId'] ?? '') ?: null);
        $approved = [];
        if ($map['senderColumn'] !== null) {
            foreach (SenderId::query()->where('organizationId', $organizationId)->where('status', 'APPROVED')->get(['id', 'value', 'type']) as $s) {
                $approved[mb_strtolower($s->value)] = ['id' => $s->id, 'value' => $s->value, 'type' => $s->type->value];
            }
        }
        $plan = $this->pricing->planFor($organizationId);
        $rates = ['MASKING' => SmsCostCalculator::rateFor($plan, $smsType, 'MASKING'), 'NON_MASKING' => SmsCostCalculator::rateFor($plan, $smsType, 'NON_MASKING')];
        $blocked = $this->contentBlocklist();

        $rows = [];
        $seen = [];
        $stats = ['totalRows' => $parsed['rowCount'], 'valid' => 0, 'invalidPhone' => 0, 'duplicates' => 0, 'missingValues' => 0, 'invalidSender' => 0,
            'malformed' => 0, 'tooLong' => 0, 'blockedContent' => 0, 'segments' => 0, 'maxSegments' => 0, 'estimatedCost' => '0', 'unicodeRows' => 0];
        foreach ($parsed['rows'] as $r) {
            $cells = $r['cells'];
            $row = ['line' => $r['line'], 'raw' => $cells[$map['recipientColumn']] ?? '', 'phone' => null, 'status' => 'INCLUDED', 'reason' => null, 'body' => null, 'sender' => null, 'segments' => 0, 'encoding' => null, 'cost' => '0', 'variables' => []];
            $phone = Phone::normalize($cells[$map['recipientColumn']] ?? '');
            $row['phone'] = $phone;
            if ($r['malformed']) {
                [$row['status'], $row['reason']] = ['SKIPPED_INVALID', 'Row has more cells than the header'];
                $stats['malformed']++;
            } elseif ($phone === null) {
                [$row['status'], $row['reason']] = ['SKIPPED_INVALID', 'Invalid Bangladeshi mobile number'];
                $stats['invalidPhone']++;
            } elseif (isset($seen[$phone])) {
                [$row['status'], $row['reason']] = ['SKIPPED_DUPLICATE', "Duplicate of row {$seen[$phone]}"];
                $stats['duplicates']++;
            }
            if ($row['status'] === 'INCLUDED') {
                $seen[$phone] = $r['line'];
                if ($map['senderColumn'] !== null) {
                    $sv = trim($cells[$map['senderColumn']] ?? '');
                    $row['sender'] = $sv === '' ? $defaultSender : ($approved[mb_strtolower($sv)] ?? null);
                    if ($row['sender'] === null) {
                        [$row['status'], $row['reason']] = ['SKIPPED_INVALID', 'Sender ID "'.mb_substr($sv, 0, 20).'" is not approved for this account'];
                        $stats['invalidSender']++;
                    }
                } else {
                    $row['sender'] = $defaultSender;
                }
            }
            if ($row['status'] === 'INCLUDED') {
                $rendered = $this->render($template, $cells, $map['fields']);
                if ($rendered['missing']) {
                    [$row['status'], $row['reason']] = ['SKIPPED_INVALID', 'No value for '.implode(', ', $rendered['missing'])];
                    $stats['missingValues']++;
                } else {
                    $body = $rendered['body'].$optOut;
                    $seg = MessageSegmentCalculator::calculate($body, $policy['segmentation']);
                    $hit = $this->blockedHit($blocked, $body);
                    if ($seg['exceedsMax']) {
                        [$row['status'], $row['reason']] = ['SKIPPED_INVALID', "Message needs {$seg['segments']} segments (max {$policy['segmentation']['maxSegments']})"];
                        $stats['tooLong']++;
                    } elseif ($hit) {
                        [$row['status'], $row['reason']] = ['SKIPPED_BLOCKED', $hit];
                        $stats['blockedContent']++;
                    } else {
                        $row['body'] = $body;
                        $row['segments'] = $seg['segments'];
                        $row['encoding'] = $seg['encoding'];
                        $row['cost'] = SmsCostCalculator::messageCost($seg['segments'], 1, $rates[$row['sender']['type']]);
                        $row['rate'] = $rates[$row['sender']['type']];
                        $row['variables'] = array_intersect_key($cells, array_flip($used));
                        $stats['valid']++;
                        $stats['segments'] += $seg['segments'];
                        $stats['maxSegments'] = max($stats['maxSegments'], $seg['segments']);
                        $stats['unicodeRows'] += (int) ($seg['encoding'] === 'UCS2');
                        $stats['estimatedCost'] = Money::add($stats['estimatedCost'], $row['cost']);
                    }
                }
            }
            $rows[] = $row;
        }

        // Platform blocklist and (promotional) opt-outs, like regular campaigns.
        $included = array_values(array_filter(array_map(fn ($r) => $r['status'] === 'INCLUDED' ? $r['phone'] : null, $rows)));
        $blockedNumbers = $this->compliance->blockedNumbers($included);
        $suppressed = $smsType === 'PROMOTIONAL' ? $this->compliance->suppressedNumbers($organizationId, $included) : [];
        $optedOut = $smsType === 'PROMOTIONAL' && $included ? Contact::query()->where('organizationId', $organizationId)->whereIn('phone', $included)->where('consentStatus', 'OPTED_OUT')->pluck('phone')->flip()->all() : [];
        $stats['blocked'] = $stats['suppressed'] = 0;
        foreach ($rows as &$row) {
            if ($row['status'] !== 'INCLUDED') {
                continue;
            }
            $why = isset($blockedNumbers[$row['phone']]) ? ['SKIPPED_BLOCKED', 'Number is blocked on the platform', 'blocked']
                : (isset($suppressed[$row['phone']]) || isset($optedOut[$row['phone']]) ? ['SKIPPED_SUPPRESSED', 'Recipient opted out of promotional messages', 'suppressed'] : null);
            if ($why) {
                [$row['status'], $row['reason']] = [$why[0], $why[1]];
                $stats[$why[2]]++;
                $stats['valid']--;
                $stats['segments'] -= $row['segments'];
                $stats['estimatedCost'] = Money::sub($stats['estimatedCost'], $row['cost']);
            }
        }
        unset($row);
        $stats['invalid'] = $stats['totalRows'] - $stats['valid'] - $stats['duplicates'];
        $stats['estimatedCost'] = Money::round($stats['estimatedCost'], 2);

        return ['rows' => $rows, 'stats' => $stats, 'mapping' => $map, 'usedFields' => $used, 'defaultSender' => $defaultSender, 'headers' => $parsed['headers']];
    }

    /** @return list<array{type: string, value: string}> */
    private function contentBlocklist(): array
    {
        return BlocklistEntry::query()->whereIn('type', ['KEYWORD', 'URL_DOMAIN'])->get(['type', 'value'])
            ->map(fn ($e) => ['type' => $e->type->value, 'value' => mb_strtolower((string) $e->value)])->filter(fn ($e) => $e['value'] !== '')->values()->all();
    }

    private function blockedHit(array $entries, string $body): ?string
    {
        $lower = mb_strtolower($body);
        foreach ($entries as $e) {
            if (str_contains($lower, $e['value'])) {
                return $e['type'] === 'URL_DOMAIN' ? 'Message contains a link to a blocked domain' : 'Message contains blocked content';
            }
        }

        return null;
    }

    // ─── Preview, estimate, submit ───

    /** @return array<string, mixed> row-by-row preview (paged) + statistics */
    public function preview(TenantContext $ctx, array $input): array
    {
        $ctx->requirePermission(['campaigns:write', 'sms:send']);
        $upload = $this->owned($ctx, (string) ($input['uploadId'] ?? ''));
        $e = $this->evaluate($ctx->organizationId, $upload, $input);
        $offset = max(0, (int) ($input['offset'] ?? 0));
        $limit = min(50, max(1, (int) ($input['limit'] ?? 20)));

        return [
            'stats' => $e['stats'],
            'fields' => $e['mapping']['fields'],
            'usedFields' => $e['usedFields'],
            'rows' => array_map(fn ($r) => [
                'line' => $r['line'], 'recipient' => $r['phone'] ?? $r['raw'], 'status' => $r['status'], 'reason' => $r['reason'],
                'message' => $r['body'], 'sender' => $r['sender']['value'] ?? null, 'segments' => $r['segments'], 'encoding' => $r['encoding'], 'cost' => Money::round($r['cost'], 4),
            ], array_slice($e['rows'], $offset, $limit)),
            'offset' => $offset,
            'total' => count($e['rows']),
        ];
    }

    /** @return array<string, mixed> */
    private function validateForSubmit(TenantContext $ctx, CampaignUpload $upload, array $input): array
    {
        $policy = $this->settings->smsPolicy();
        $e = $this->evaluate($ctx->organizationId, $upload, $input);
        $this->compliance->assertContentAllowed((string) $input['message']);
        if (($input['missingValues'] ?? 'skip') === 'reject' && $e['stats']['missingValues'] > 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, "{$e['stats']['missingValues']} rows have no value for a field used in the message. Fill them in or choose to skip such rows.", ['field' => 'missingValues']);
        }
        if ($e['stats']['valid'] === 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'None of the rows can be sent (invalid numbers, missing values, unapproved sender IDs, blocked or opted out).', ['field' => 'file']);
        }
        $scheduledAt = null;
        if (($input['scheduleMode'] ?? 'now') === 'later') {
            $scheduledAt = CampaignService::parseScheduledAt($input['scheduledAt'] ?? null);
            if (! $scheduledAt || $scheduledAt->lt(CarbonImmutable::now()->addMinute()) || $scheduledAt->gt(CarbonImmutable::now()->addDays(90))) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Choose a time between one minute and 90 days from now.', ['field' => 'scheduledAt']);
            }
        }
        $smsType = (string) $input['smsType'];
        if ($smsType === 'PROMOTIONAL') {
            $this->compliance->assertNotQuietHours($policy, $scheduledAt ?? CarbonImmutable::now());
        }
        $org = Organization::query()->findOrFail($ctx->organizationId, ['id', 'requireCampaignReview', 'createdAt']);
        $sample = implode("\n", array_slice(array_values(array_filter(array_map(fn ($r) => $r['body'], $e['rows']))), 0, 50));
        $risk = $this->risk->evaluate((string) $input['message']."\n".$sample, $smsType, $e['stats']['valid'], $org->createdAt->diffInSeconds(now()) / 86400);
        $reasons = $risk['reasons'];
        if ($org->requireCampaignReview && ($smsType === 'PROMOTIONAL' || $e['stats']['valid'] > 50)) {
            $reasons[] = "Your account's campaigns get a safety check before sending";
        }
        $balance = $this->wallet->balance($ctx->organizationId);

        return $e + ['scheduledAt' => $scheduledAt, 'reviewReasons' => $reasons, 'balance' => $balance, 'batchSize' => $this->campaigns->resolveBatchSize($input['batchSize'] ?? null)];
    }

    /** @return array<string, mixed> final confirmation summary */
    public function estimate(TenantContext $ctx, array $input): array
    {
        $ctx->requirePermission(['campaigns:write', 'sms:send']);
        $upload = $this->owned($ctx, (string) ($input['uploadId'] ?? ''));
        $v = $this->validateForSubmit($ctx, $upload, $input);
        $s = $v['stats'];
        $first = collect($v['rows'])->firstWhere('status', 'INCLUDED');

        return [
            'name' => $this->name($input),
            'messageType' => $input['smsType'],
            'recipients' => $s['valid'],
            'stats' => $s,
            'senderValue' => $v['defaultSender']['value'],
            'senderColumn' => $v['mapping']['senderColumn'],
            'recipientColumn' => $v['mapping']['recipientColumn'],
            'variables' => $v['usedFields'],
            'segments' => $s['segments'],
            'segmentsPerMessageMax' => $s['maxSegments'],
            'estimatedCost' => $s['estimatedCost'],
            'balance' => Money::round($v['balance'], 2),
            'sufficientBalance' => Money::cmp($v['balance'], $s['estimatedCost']) >= 0,
            'requiresReview' => (bool) $v['reviewReasons'],
            'reviewReasons' => $v['reviewReasons'],
            'scheduledAt' => Dhaka::iso($v['scheduledAt']),
            'batchSize' => $v['batchSize'],
            'batches' => (int) ceil($s['valid'] / max(1, $v['batchSize'])),
            'sample' => $first ? ['recipient' => $first['phone'], 'message' => $first['body']] : null,
        ];
    }

    private function name(array $input): string
    {
        $n = trim((string) ($input['name'] ?? ''));

        return $n !== '' ? mb_substr($n, 0, 120) : 'Dynamic SMS '.Dhaka::formatDateTime(CarbonImmutable::now());
    }

    /** @return array{campaign: Campaign, launchNow: bool} */
    public function submit(TenantContext $ctx, array $input): array
    {
        $ctx->requirePermission(['campaigns:write', 'sms:send']);
        $ctx->assertActive();
        if (empty($input['confirmed'])) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Confirm the summary before sending.', ['field' => 'confirmed']);
        }
        app(SmsProviderManager::class)->sendingProvider();
        $upload = $this->owned($ctx, (string) ($input['uploadId'] ?? ''));
        if ($upload->status !== 'READY') {
            throw new AppException(ErrorCode::CONFLICT, 'This file was already used for a campaign. Upload it again to send another one.');
        }
        $v = $this->validateForSubmit($ctx, $upload, $input);
        if (Money::cmp($v['balance'], $v['stats']['estimatedCost']) < 0) {
            throw new AppException(ErrorCode::INSUFFICIENT_BALANCE, "This campaign needs BDT {$v['stats']['estimatedCost']}; your balance is BDT ".Money::round($v['balance'], 2).'. Add balance and try again.');
        }
        $status = $v['reviewReasons'] ? 'PENDING_REVIEW' : 'SCHEDULED';
        $policy = $this->settings->smsPolicy();
        $seg = MessageSegmentCalculator::calculate((string) $input['message'], $policy['segmentation']);
        $campaign = DB::transaction(function () use ($ctx, $input, $upload, $v, $status, $seg) {
            // Exactly one campaign per upload, even for concurrent submits.
            if (! CampaignUpload::query()->whereKey($upload->id)->where('organizationId', $ctx->organizationId)->where('status', 'READY')->update(['status' => 'USED', 'updatedAt' => now()->format('Y-m-d H:i:s.v')])) {
                throw new AppException(ErrorCode::CONFLICT, 'This file was already used for a campaign.');
            }
            $c = Campaign::query()->forceCreate([
                'organizationId' => $ctx->organizationId, 'createdById' => $ctx->userId, 'kind' => 'DYNAMIC',
                'name' => $this->name($input), 'smsType' => $input['smsType'],
                'senderIdId' => $v['defaultSender']['id'], 'senderValue' => $v['defaultSender']['value'], 'senderType' => $v['defaultSender']['type'],
                'message' => (string) $input['message'], 'encoding' => $seg['encoding'], 'segmentsPerMessage' => max(1, $v['stats']['maxSegments']),
                'audience' => ['groupIds' => [], 'numbers' => []], 'scheduledAt' => $v['scheduledAt'], 'status' => $status,
                'estimatedCost' => $v['stats']['estimatedCost'], 'recipientCount' => $v['stats']['valid'], 'batchSize' => $v['batchSize'],
                'reviewNote' => $v['reviewReasons'] ? implode('; ', $v['reviewReasons']) : null,
                'dynamicConfig' => [
                    'uploadId' => $upload->id, 'fileName' => $upload->fileName, 'rowCount' => $v['stats']['totalRows'],
                    'recipientColumn' => $v['mapping']['recipientColumn'], 'senderColumn' => $v['mapping']['senderColumn'],
                    'fields' => $v['usedFields'], 'missingValues' => ($input['missingValues'] ?? 'skip') === 'reject' ? 'reject' : 'skip',
                    'defaultSenderId' => (string) ($input['senderId'] ?? ''),
                ],
            ]);
            CampaignUpload::query()->whereKey($upload->id)->update(['campaignId' => $c->id]);

            return $c;
        });
        if ($status === 'PENDING_REVIEW') {
            app(NotificationService::class)->notifyStaff('staff.campaign_risk', "Campaign held for a safety check: {$campaign->name}", implode('; ', $v['reviewReasons']), '/admin/campaigns?status=PENDING_REVIEW');
        }
        $this->audit->log($status === 'PENDING_REVIEW' ? 'campaign.submit_for_review' : 'campaign.schedule', $ctx->actor(), $ctx->organizationId, 'campaign', $campaign->id, [
            'kind' => 'DYNAMIC', 'recipients' => $v['stats']['valid'], 'skipped' => $v['stats']['totalRows'] - $v['stats']['valid'],
            'estimatedCost' => $v['stats']['estimatedCost'], 'scheduledAt' => Dhaka::iso($v['scheduledAt']), 'reasons' => $v['reviewReasons'], 'batchSize' => $v['batchSize'],
        ]);

        return ['campaign' => $campaign, 'launchNow' => $status === 'SCHEDULED' && ! $v['scheduledAt']];
    }

    /**
     * Rows of a DYNAMIC campaign at launch time, in the shape CampaignRunner expects. Re-evaluated
     * from the stored file so sender approvals, opt-outs and the blocklist are current.
     *
     * @return list<array{phone: string, contactId: null, variables: array<string, string>, status: string, body?: string, sender?: array, segments?: int, encoding?: string, rate?: string}>
     */
    public function materialize(Campaign $campaign): array
    {
        $cfg = (array) $campaign->dynamicConfig;
        $upload = CampaignUpload::query()->where('organizationId', $campaign->organizationId)->whereKey($cfg['uploadId'] ?? '')->first()
            ?? throw new AppException(ErrorCode::CONFLICT, 'The uploaded file of this campaign is no longer available.');
        $e = $this->evaluate($campaign->organizationId, $upload, [
            'recipientColumn' => $cfg['recipientColumn'] ?? '', 'senderColumn' => $cfg['senderColumn'] ?? null,
            'message' => $campaign->message, 'smsType' => $campaign->smsType->value, 'senderId' => $cfg['defaultSenderId'] ?? '',
        ]);
        if (($cfg['missingValues'] ?? 'skip') === 'reject' && $e['stats']['missingValues'] > 0) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Some rows have no value for a field used in the message.');
        }
        $out = [];
        foreach ($e['rows'] as $r) {
            $phone = $r['phone'] ?? mb_substr((string) $r['raw'], 0, 32);
            if ($phone === '') {
                $phone = 'row-'.$r['line'];
            }
            $base = ['phone' => $phone, 'contactId' => null, 'variables' => $r['variables'], 'status' => $r['status'], 'line' => $r['line']];
            $out[] = $r['status'] === 'INCLUDED'
                ? $base + ['body' => $r['body'], 'sender' => $r['sender'], 'segments' => $r['segments'], 'encoding' => $r['encoding'], 'rate' => $r['rate']]
                : $base;
        }

        return $out;
    }

    /** Deletes the stored CSV once the rows live in campaign_recipients/messages, or the upload expired. */
    public function cleanup(): int
    {
        $n = 0;
        $stale = CampaignUpload::query()->where(function ($q) {
            $q->where(fn ($w) => $w->where('status', 'READY')->where('expiresAt', '<', now()->format('Y-m-d H:i:s.v')))
                // Kept while the campaign can still launch (incl. a FAILED launch the customer may retry, for 7 days).
                ->orWhere(fn ($w) => $w->where('status', 'USED')->whereExists(fn ($e) => $e->from('campaigns')->whereColumn('campaigns.id', 'campaign_uploads.campaignId')
                    ->where(fn ($s) => $s->whereNotIn('campaigns.status', ['DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'FAILED'])
                        ->orWhere(fn ($f) => $f->where('campaigns.status', 'FAILED')->where('campaigns.updatedAt', '<', now()->subDays(7)->format('Y-m-d H:i:s.v'))))));
        })->limit(200)->get(['id', 'fileKey']);
        foreach ($stale as $u) {
            if (! str_contains($u->fileKey, '..')) {
                $this->disk()->delete($u->fileKey);
            }
            CampaignUpload::query()->whereKey($u->id)->update(['status' => 'EXPIRED', 'updatedAt' => now()->format('Y-m-d H:i:s.v')]);
            $n++;
        }

        return $n;
    }

    /** CSV template customers can download. */
    public static function templateCsv(): string
    {
        return "\u{FEFF}Retail Name,Mobile Number,Due Amount,Invoice\r\nRahim Store,01712345678,1500,INV-001\r\nKarim Traders,01812345678,2500,INV-002\r\nNoor Enterprise,01912345678,3000,INV-003\r\n";
    }
}
