<?php

namespace App\Http\Controllers\Api\V1\Campaigns;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Resources\CampaignResource;
use App\Jobs\LaunchCampaignJob;
use App\Services\Campaign\DynamicSmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Dynamic SMS (per-row CSV personalisation, docs/20). Behind `feature:dynamic_sms`.
 * Upload → mapping → template → preview → estimate (confirmation summary) → submit.
 */
class DynamicSmsController extends ApiController
{
    public function __construct(private readonly DynamicSmsService $dynamic) {}

    /** @return array<string, mixed> */
    private function input(Request $request): array
    {
        $v = $request->validate([
            'uploadId' => ['required', 'uuid'],
            'recipientColumn' => ['required', 'string', 'max:64'],
            'senderColumn' => ['nullable', 'string', 'max:64'],
            'senderId' => ['nullable', 'string', 'max:20'],
            'message' => ['present', 'nullable', 'string', 'max:3000'],
            'smsType' => ['required', 'in:TRANSACTIONAL,PROMOTIONAL'],
            'name' => ['nullable', 'string', 'max:120'],
            'missingValues' => ['nullable', 'in:skip,reject'],
            'batchSize' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'scheduleMode' => ['nullable', 'in:now,later'],
            'scheduledAt' => ['nullable', 'string', 'max:40'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
            'confirmed' => ['nullable', 'boolean'],
        ], ['recipientColumn.required' => 'Choose the column that holds the recipient mobile numbers.']);
        $v['message'] = (string) ($v['message'] ?? '');
        $v['batchSize'] = isset($v['batchSize']) ? (int) $v['batchSize'] : null;
        $v['confirmed'] = $request->boolean('confirmed');

        return $v;
    }

    /** POST /app/dynamic-sms/uploads (multipart: file) → headers, preview, suggestions. */
    public function upload(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file']], ['file.required' => 'Choose a CSV file.']);

        return $this->ok($this->dynamic->upload($this->tenant($request), $request->file('file')), 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return $this->ok($this->dynamic->show($this->tenant($request), $id));
    }

    /** GET /app/dynamic-sms/template: sample CSV (UTF-8 with BOM, so Excel shows Bangla correctly). */
    public function template(): Response
    {
        return response(DynamicSmsService::templateCsv(), 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="dynamic-sms-template.csv"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** POST /app/dynamic-sms/preview: row-by-row rendering + statistics (offset/limit pages). */
    public function preview(Request $request): JsonResponse
    {
        return $this->ok($this->dynamic->preview($this->tenant($request), $this->input($request)));
    }

    /** POST /app/dynamic-sms/estimate: final confirmation summary (cost, balance, review need). */
    public function estimate(Request $request): JsonResponse
    {
        return $this->ok($this->dynamic->estimate($this->tenant($request), $this->input($request)));
    }

    /** POST /app/dynamic-sms/submit {…, confirmed: true}: creates and queues the campaign. */
    public function submit(Request $request): JsonResponse
    {
        ['campaign' => $c, 'launchNow' => $launchNow] = $this->dynamic->submit($this->tenant($request), $this->input($request));
        if ($launchNow) {
            LaunchCampaignJob::dispatch($c->id);
        }
        $message = $c->status->value === 'PENDING_REVIEW'
            ? "Held for a safety check. We'll notify you as soon as it is cleared."
            : ($c->scheduledAt ? 'Dynamic campaign scheduled.' : 'Dynamic campaign queued. Sending starts in batches.');

        return $this->resource($request, CampaignResource::class, $c, 202, ['message' => $message]);
    }
}
