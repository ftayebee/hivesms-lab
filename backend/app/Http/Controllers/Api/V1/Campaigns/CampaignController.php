<?php

namespace App\Http\Controllers\Api\V1\Campaigns;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Messaging\CampaignRequest;
use App\Http\Resources\CampaignResource;
use App\Http\Resources\MessageResource;
use App\Jobs\LaunchCampaignJob;
use App\Services\Campaign\CampaignService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\MessageSegmentCalculator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Campaigns (bulk SMS). Lifecycle: draft → submit (SCHEDULED, or PENDING_REVIEW) → launch job
 * charges the wallet once and queues messages → dispatcher sends → delivery reports → COMPLETED.
 * Nothing is sent inside the HTTP request.
 */
class CampaignController extends ApiController
{
    public function __construct(private readonly CampaignService $campaigns) {}

    /** GET /app/campaigns?q=&status=&type=&page= (with per-status counts in meta). */
    public function index(Request $request): JsonResponse
    {
        $q = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:DRAFT,PENDING_REVIEW,SCHEDULED,PROCESSING,COMPLETED,PAUSED,CANCELLED,FAILED'],
            'type' => ['nullable', 'in:TRANSACTIONAL,PROMOTIONAL'],
        ]);
        $r = $this->campaigns->list($this->tenant($request), $q + ['page' => $this->page($request)]);

        return $this->paginated($request, $r['page'], CampaignResource::class, ['statusCounts' => (object) $r['statusCounts']]);
    }

    /** POST /app/campaigns: save a draft (partial content allowed). */
    public function store(CampaignRequest $request): JsonResponse
    {
        return $this->resource($request, CampaignResource::class, $this->campaigns->saveDraft($this->tenant($request), $request->payload()), 201);
    }

    /** GET /app/campaigns/{id}: campaign + live stats, skipped breakdown, failures, operators, timeline. */
    public function show(Request $request, string $id): JsonResponse
    {
        $d = $this->campaigns->detail($this->tenant($request), $id);
        $d['campaign'] = (new CampaignResource($d['campaign']))->resolve($request);
        $d['skipped'] = (object) $d['skipped'];

        return $this->ok($d);
    }

    /** PUT /app/campaigns/{id}: update a draft. */
    public function update(CampaignRequest $request, string $id): JsonResponse
    {
        return $this->resource($request, CampaignResource::class, $this->campaigns->saveDraft($this->tenant($request), ['id' => $id] + $request->payload()));
    }

    /** DELETE: drafts and cancelled campaigns only. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->campaigns->delete($this->tenant($request), $id);

        return $this->ok(['deleted' => true]);
    }

    /** POST /app/campaigns/estimate: audience, segments, cost, balance check, review requirement. */
    public function estimate(CampaignRequest $request): JsonResponse
    {
        return $this->ok($this->campaigns->estimate($this->tenant($request), $request->payload()));
    }

    /** POST /app/campaigns/submit: create (or submit a draft by id) and send now / schedule. */
    public function submit(CampaignRequest $request): JsonResponse
    {
        return $this->doSubmit($request, $request->payload());
    }

    /** POST /app/campaigns/{id}/send: submit a saved draft now (body fields optional, override the draft). */
    public function send(Request $request, string $id): JsonResponse
    {
        $input = array_merge($this->campaigns->draftInput($this->tenant($request), $id), $this->overrides($request), ['id' => $id, 'scheduleMode' => 'now', 'scheduledAt' => '']);

        return $this->doSubmit($request, $input);
    }

    /** POST /app/campaigns/{id}/schedule {scheduledAt}: submit a saved draft for a later time. */
    public function schedule(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['scheduledAt' => ['required', 'string', 'max:40']], ['scheduledAt.required' => 'Choose a date and time.']);
        $input = array_merge($this->campaigns->draftInput($this->tenant($request), $id), $this->overrides($request), ['id' => $id, 'scheduleMode' => 'later', 'scheduledAt' => $data['scheduledAt']]);

        return $this->doSubmit($request, $input);
    }

    private function overrides(Request $request): array
    {
        $o = $request->validate(['name' => ['nullable', 'string', 'max:120'], 'message' => ['nullable', 'string', 'max:3000'], 'senderId' => ['nullable', 'string', 'max:20']]);

        return array_filter($o, fn ($v) => $v !== null && $v !== '');
    }

    private function doSubmit(Request $request, array $input): JsonResponse
    {
        ['campaign' => $c, 'launchNow' => $launchNow] = $this->campaigns->submit($this->tenant($request), $input);
        if ($launchNow) {
            LaunchCampaignJob::dispatch($c->id);
        }
        $message = $c->status->value === 'PENDING_REVIEW'
            ? "Submitted for review. We'll notify you when it's approved."
            : ($c->scheduledAt ? 'Campaign scheduled.' : 'Sending started.');

        return $this->resource($request, CampaignResource::class, $c, 202, ['message' => $message]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $this->campaigns->cancel($this->tenant($request), $id);

        return $this->ok(['message' => 'Campaign cancelled. Unsent messages are refunded.']);
    }

    public function pause(Request $request, string $id): JsonResponse
    {
        $this->campaigns->pause($this->tenant($request), $id);

        return $this->ok(['message' => 'Campaign paused. Unsent messages will wait until you resume.']);
    }

    public function resume(Request $request, string $id): JsonResponse
    {
        $this->campaigns->resume($this->tenant($request), $id);

        return $this->ok(['message' => 'Campaign resumed.']);
    }

    public function duplicate(Request $request, string $id): JsonResponse
    {
        return $this->resource($request, CampaignResource::class, $this->campaigns->duplicate($this->tenant($request), $id), 201, ['message' => 'Copied as a new draft.']);
    }

    public function retry(Request $request, string $id): JsonResponse
    {
        $c = $this->campaigns->retry($this->tenant($request), $id);
        LaunchCampaignJob::dispatch($c->id);

        return $this->resource($request, CampaignResource::class, $c, 202, ['message' => 'Sending started.']);
    }

    /** GET /app/campaigns/{id}/stats: live counters only (cheap polling while sending). */
    public function stats(Request $request, string $id): JsonResponse
    {
        $d = $this->campaigns->detail($this->tenant($request), $id);

        return $this->ok(['status' => $d['campaign']->status->value, 'stats' => $d['stats'], 'skipped' => (object) $d['skipped']]);
    }

    /** GET /app/campaigns/{id}/messages?status=&page=&pageSize= */
    public function messages(Request $request, string $id): JsonResponse
    {
        $q = $request->validate(['status' => ['nullable', 'in:QUEUED,SUBMITTED,DELIVERED,FAILED,REJECTED,EXPIRED,CANCELLED'], 'pageSize' => ['nullable', 'integer', 'min:10', 'max:100']]);

        return $this->paginated($request, $this->campaigns->messages($this->tenant($request), $id, $q['status'] ?? null, $this->page($request), (int) ($q['pageSize'] ?? 25)), MessageResource::class);
    }

    public function export(Request $request, string $id): StreamedResponse
    {
        $ctx = $this->tenant($request);
        $ctx->requirePermission('reports:export');
        $name = $this->campaigns->owned($ctx, $id)->name;

        return $this->csv("campaign-{$name}", fn (callable $write) => $this->campaigns->exportReport($ctx, $id, $write));
    }

    /** POST /app/sms/segments {message}: segmentation with the live (admin-configured) rules. */
    public function segments(Request $request, SettingsService $settings): JsonResponse
    {
        $data = $request->validate(['message' => ['present', 'nullable', 'string', 'max:3000']]);
        $policy = $settings->smsPolicy();

        return $this->ok(MessageSegmentCalculator::calculate((string) ($data['message'] ?? ''), $policy['segmentation']) + ['maxSegments' => $policy['segmentation']['maxSegments']]);
    }
}
