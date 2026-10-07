<?php

namespace App\Http\Controllers\Api\V1\Sms;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Messaging\BulkSmsRequest;
use App\Http\Requests\Messaging\EstimateSmsRequest;
use App\Http\Requests\Messaging\SendSmsRequest;
use App\Jobs\DispatchMessagesJob;
use App\Services\Messaging\SendService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SmsCostCalculator;
use App\Support\Money;
use Illuminate\Http\JsonResponse;

/**
 * Public SMS API (API-key auth, scope sms:send). Responses are the existing customer contract
 * (snake_case). Messages are charged and queued in one transaction, then sent right after the
 * response (or by the worker); the HTTP request never waits for the provider.
 */
class SmsController extends ApiController
{
    public function __construct(private readonly SendService $send) {}

    /** POST /api/v1/sms/send */
    public function send(SendSmsRequest $request): JsonResponse
    {
        $scheduleAt = $request->scheduleAt();
        $r = $this->send->send($this->tenant($request), [
            'recipients' => [['phone' => (string) $request->input('to')]],
            'message' => (string) $request->input('message'),
            'senderId' => $request->input('sender_id'),
            'smsType' => $request->smsType(),
            'source' => 'API',
            'clientReference' => $request->input('reference'),
            'scheduledAt' => $scheduleAt,
            'mode' => 'single',
        ]);
        $m = $r['accepted'][0];
        if (! $scheduleAt) {
            DispatchMessagesJob::afterResponse([$m['id']]);
        }

        return $this->ok([
            'message_id' => $m['id'],
            'to' => $m['to'],
            'status' => 'queued',
            'segments' => $m['segments'],
            'encoding' => $m['encoding'],
            'cost' => $m['cost'],
            'currency' => 'BDT',
            'scheduled_for' => $r['scheduledAt'],
        ], 202);
    }

    /** POST /api/v1/sms/bulk — up to 1,000 recipients; invalid ones are reported, not fatal. */
    public function bulk(BulkSmsRequest $request): JsonResponse
    {
        $scheduleAt = $request->scheduleAt();
        $r = $this->send->send($this->tenant($request), [
            'recipients' => $request->recipients(),
            'message' => (string) $request->input('message'),
            'senderId' => $request->input('sender_id'),
            'smsType' => $request->smsType(),
            'source' => 'API',
            'clientReference' => $request->input('reference'),
            'scheduledAt' => $scheduleAt,
            'mode' => 'bulk',
        ]);
        if (! $scheduleAt && count($r['accepted']) <= (int) config('smsflow.sms.inline_dispatch_max')) {
            DispatchMessagesJob::afterResponse(array_column($r['accepted'], 'id'));
        }

        return $this->ok([
            'batch_id' => $r['batchId'],
            'accepted' => count($r['accepted']),
            'rejected' => count($r['rejected']),
            'total_segments' => $r['totalSegments'],
            'total_cost' => $r['totalCost'],
            'currency' => 'BDT',
            'scheduled_for' => $r['scheduledAt'],
            'messages' => array_map(fn ($m) => ['message_id' => $m['id'], 'to' => $m['to'], 'status' => 'queued', 'segments' => $m['segments'], 'cost' => $m['cost']], $r['accepted']),
            'errors' => array_map(fn ($e) => ['to' => $e['to'], 'code' => $e['code'], 'message' => $e['reason']], $r['rejected']),
        ], 202);
    }

    /** POST /api/v1/sms/estimate — nothing is sent or charged. */
    public function estimate(EstimateSmsRequest $request, SettingsService $settings, SmsCostCalculator $pricing): JsonResponse
    {
        $ctx = $this->tenant($request);
        $policy = $settings->smsPolicy();
        $sender = $this->send->resolveSender($ctx->organizationId, $request->input('sender_id'));
        $seg = MessageSegmentCalculator::calculate((string) $request->input('message'), $policy['segmentation']);
        $rate = SmsCostCalculator::rateFor($pricing->planFor($ctx->organizationId), $request->smsType(), $sender['type']);
        $recipients = (int) ($request->input('recipients') ?? 1);

        return $this->ok([
            'encoding' => $seg['encoding'],
            'characters' => $seg['characters'],
            'units' => $seg['units'],
            'segments' => $seg['segments'],
            'max_segments' => $policy['segmentation']['maxSegments'],
            'exceeds_max' => $seg['exceedsMax'],
            'recipients' => $recipients,
            'sender_id' => $sender['value'],
            'sender_type' => $sender['type'],
            'rate' => Money::round($rate, 4),
            'estimated_cost' => Money::round(SmsCostCalculator::messageCost($seg['segments'], $recipients, $rate), 2),
            'currency' => 'BDT',
        ]);
    }
}
