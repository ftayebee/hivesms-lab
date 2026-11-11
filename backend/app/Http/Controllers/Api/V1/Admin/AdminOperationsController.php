<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\AppException;
use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Resources\MessageResource;
use App\Models\Message;
use App\Services\Messaging\DeliveryService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\SettingsService;
use App\Services\SenderId\SenderCatalogService;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super Admin operations added with dynamic SMS and batch processing (docs/21, docs/22):
 * unconfirmed-message review, the provider sender catalog, campaign-processing settings.
 */
class AdminOperationsController extends ApiController
{
    // ─── Unconfirmed (UNKNOWN) messages ───

    /** GET /admin/messages/unconfirmed?organizationId=&campaignId=&page= */
    public function unconfirmed(Request $request): JsonResponse
    {
        $f = $request->validate(['organizationId' => ['nullable', 'uuid'], 'campaignId' => ['nullable', 'uuid']]);
        $page = Message::query()->where('status', 'UNKNOWN')
            ->when($f['organizationId'] ?? null, fn ($q, $v) => $q->where('organizationId', $v))
            ->when($f['campaignId'] ?? null, fn ($q, $v) => $q->where('campaignId', $v))
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'name']), 'campaign' => fn ($q) => $q->withTrashed()->select(['id', 'name'])])
            ->orderBy('updatedAt')
            ->paginate(50, ['id', 'organizationId', 'campaignId', 'to', 'senderValue', 'status', 'segments', 'cost', 'provider', 'providerMessageId', 'providerStatusCode',
                'providerResponse', 'providerRequestedAt', 'providerRespondedAt', 'errorCode', 'errorMessage', 'batchNumber', 'createdAt', 'updatedAt'], 'page', $this->page($request));

        return $this->paginated($request, $page, MessageResource::class);
    }

    /**
     * POST /admin/messages/{id}/resolve {outcome: delivered|accepted|failed, refund?: bool, reason}
     * After checking the provider panel/report. Refunds only on an explicit "failed + refund".
     */
    public function resolve(Request $request, string $id, DeliveryService $delivery, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate([
            'outcome' => ['required', 'in:delivered,accepted,failed'], 'refund' => ['nullable', 'boolean'],
            'reason' => ['required', 'string', 'min:3', 'max:500'], 'providerReference' => ['nullable', 'string', 'max:255'],
        ], ['reason.required' => 'Say what you checked (e.g. "Delivered per provider report").']);
        $m = Message::query()->find($id, ['id', 'organizationId', 'status']) ?? throw new AppException(ErrorCode::NOT_FOUND, 'Message not found.');
        if ($m->status->value !== 'UNKNOWN') {
            throw new AppException(ErrorCode::CONFLICT, 'Only unconfirmed messages can be resolved here.');
        }
        $status = ['delivered' => 'DELIVERED', 'accepted' => 'SUBMITTED', 'failed' => 'FAILED'][$data['outcome']];
        $admin = $this->admin($request);
        $refund = $status === 'FAILED' && $request->boolean('refund');
        $outcome = $delivery->apply([
            'messageId' => $id, 'status' => $status, 'source' => 'SYSTEM', 'dedupeKey' => "resolve:{$id}",
            'description' => "Resolved by staff: {$data['reason']}", 'refund' => $refund,
            'providerMessageId' => $data['providerReference'] ?? null,
        ]);
        if ($outcome !== 'applied') {
            throw new AppException(ErrorCode::CONFLICT, 'This message was already resolved.');
        }
        $audit->log('admin.message.resolve', $admin->actor(), $m->organizationId, 'message', $id, ['outcome' => $data['outcome'], 'refund' => $refund, 'reason' => $data['reason']], $admin->ip, $admin->userAgent);

        return $this->ok(['id' => $id, 'status' => $status, 'refunded' => $refund]);
    }

    // ─── Sender catalog ───

    public function catalog(SenderCatalogService $catalog): JsonResponse
    {
        return $this->ok($catalog->list());
    }

    public function syncCatalog(Request $request, SenderCatalogService $catalog): JsonResponse
    {
        return $this->ok($catalog->sync($this->admin($request)));
    }

    public function addCatalog(Request $request, SenderCatalogService $catalog): JsonResponse
    {
        $data = $request->validate(['value' => ['required', 'string', 'max:20'], 'type' => ['required', 'in:MASKING,NON_MASKING'], 'note' => ['nullable', 'string', 'max:255']]);
        $e = $catalog->add($this->admin($request), $data['value'], $data['type'], $data['note'] ?? null);

        return $this->ok(['id' => $e->id], 201);
    }

    public function updateCatalog(Request $request, string $id, SenderCatalogService $catalog): JsonResponse
    {
        $data = $request->validate(['active' => ['required', 'boolean'], 'note' => ['nullable', 'string', 'max:255']]);
        $catalog->update($this->admin($request), $id, $request->boolean('active'), $data['note'] ?? null);

        return $this->ok(['id' => $id]);
    }

    /** PUT /admin/sender-catalog/{id}/assignments {organizationIds: [...]} — the complete new set. */
    public function assignCatalog(Request $request, string $id, SenderCatalogService $catalog): JsonResponse
    {
        $data = $request->validate(['organizationIds' => ['present', 'array', 'max:500'], 'organizationIds.*' => ['uuid']]);

        return $this->ok($catalog->assign($this->admin($request), $id, $data['organizationIds']));
    }

    // ─── Campaign processing + manual payment policy ───

    public function processingSettings(SettingsService $settings): JsonResponse
    {
        $d = config('smsflow.campaign_processing');

        return $this->ok([
            'campaign' => $settings->campaignProcessing(),
            'manualPayments' => $settings->manualPaymentPolicy(),
            'limits' => ['hardMaxBatchSize' => $d['hardMaxBatchSize'], 'hardMaxConcurrency' => $d['hardMaxConcurrency'], 'hardMaxDynamicRows' => $d['hardMaxDynamicRows']],
        ]);
    }

    public function updateProcessingSettings(Request $request, SettingsService $settings, AuditLogger $audit): JsonResponse
    {
        $d = config('smsflow.campaign_processing');
        $v = $request->validate([
            'allowedBatchSizes' => ['required', 'array', 'min:1', 'max:6'], 'allowedBatchSizes.*' => ['integer', 'min:1', 'max:'.$d['hardMaxBatchSize']],
            'defaultBatchSize' => ['required', 'integer', 'min:1'],
            'maxDynamicRows' => ['required', 'integer', 'min:1', 'max:'.$d['hardMaxDynamicRows']],
            'maxBatchesPerTick' => ['required', 'integer', 'min:1', 'max:200'],
            'throttleMs' => ['required', 'integer', 'min:0', 'max:5000'],
            'providerConcurrency' => ['required', 'array'], 'providerConcurrency.*' => ['integer', 'min:1', 'max:'.$d['hardMaxConcurrency']],
            'risk.newAccountDays' => ['required', 'integer', 'min:0', 'max:365'],
            'risk.newAccountMaxRecipients' => ['required', 'integer', 'min:0', 'max:10000000'],
            'risk.transactionalBulkThreshold' => ['required', 'integer', 'min:0', 'max:10000000'],
            'risk.holdAboveRecipients' => ['required', 'integer', 'min:0', 'max:10000000'],
            'manualPayments.proofMaxBytes' => ['required', 'integer', 'min:102400', 'max:10485760'],
            'manualPayments.maxOpenRequestsPerOrganization' => ['required', 'integer', 'min:1', 'max:50'],
            'manualPayments.suspiciousAmount' => ['required', 'integer', 'min:1', 'max:100000000'],
        ]);
        $allowed = array_values(array_unique(array_map('intval', $v['allowedBatchSizes'])));
        sort($allowed);
        if (! in_array((int) $v['defaultBatchSize'], $allowed, true)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'The default batch size must be one of the permitted sizes.', ['field' => 'defaultBatchSize']);
        }
        foreach (array_keys($v['providerConcurrency']) as $k) {
            if (! preg_match('/^[a-z0-9_-]{1,30}$/', (string) $k)) {
                throw new AppException(ErrorCode::VALIDATION_ERROR, 'Unknown provider key.', ['field' => 'providerConcurrency']);
            }
        }
        $admin = $this->admin($request);
        $before = ['campaign' => $settings->campaignProcessing(), 'manualPayments' => $settings->manualPaymentPolicy()];
        $campaign = ['allowedBatchSizes' => $allowed, 'defaultBatchSize' => (int) $v['defaultBatchSize'], 'maxDynamicRows' => (int) $v['maxDynamicRows'],
            'maxBatchesPerTick' => (int) $v['maxBatchesPerTick'], 'throttleMs' => (int) $v['throttleMs'],
            'providerConcurrency' => array_map('intval', $v['providerConcurrency']), 'risk' => array_map('intval', $v['risk'])];
        $settings->set('campaign.processing', $campaign, $admin->userId);
        $settings->set('payments.manual', array_map('intval', $v['manualPayments']), $admin->userId);
        $settings->clearCache();
        $after = ['campaign' => $settings->campaignProcessing(), 'manualPayments' => $settings->manualPaymentPolicy()];
        $audit->log('settings.campaign_processing.update', $admin->actor(), null, 'setting', 'campaign.processing', ['before' => $before, 'after' => $after], $admin->ip, $admin->userAgent);

        return $this->ok($after);
    }
}
