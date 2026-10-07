<?php

namespace App\Http\Resources;

use App\Support\Dhaka;
use App\Support\Money;

/**
 * Public SMS API message — a customer contract (port of features/public-api/serializers.ts):
 * snake_case, lower-case enums, money as strings with 2 decimals.
 */
class PublicMessageResource extends BaseResource
{
    public function toArray($request): array
    {
        $m = $this->resource;
        $out = [
            'message_id' => $m->id,
            'to' => $m->to,
            'status' => strtolower($m->status->value),
            'type' => strtolower($m->smsType->value),
            'sender_id' => $m->senderValue,
            'segments' => $m->segments,
            'encoding' => $m->encoding->value,
            'cost' => Money::round((string) $m->cost, 2),
            'currency' => 'BDT',
            'refunded' => $m->refundedAt !== null,
            'error_code' => $m->errorCode,
            'error_message' => $m->errorMessage,
            'reference' => $m->clientReference,
            'campaign_id' => $m->campaignId,
            'queued_at' => Dhaka::iso($m->queuedAt),
            'scheduled_for' => $m->nextAttemptAt && $m->status->value === 'QUEUED' && $m->nextAttemptAt->gt($m->queuedAt) ? Dhaka::iso($m->nextAttemptAt) : null,
            'submitted_at' => Dhaka::iso($m->submittedAt),
            'delivered_at' => Dhaka::iso($m->deliveredAt),
            'failed_at' => Dhaka::iso($m->failedAt),
        ];
        if ($m->relationLoaded('events')) {
            $out['events'] = $m->events->filter(fn ($e) => $e->status->value !== 'QUEUED')->map(fn ($e) => [
                'status' => strtolower($e->status->value), 'at' => Dhaka::iso($e->occurredAt), 'description' => $e->description,
            ])->values()->all();
        }

        return $out;
    }
}
