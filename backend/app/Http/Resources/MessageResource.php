<?php

namespace App\Http\Resources;

use App\Support\Dhaka;

/** Dashboard message (dispatch internals such as attempts and leases are not exposed). */
class MessageResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'campaignId' => $this->f('campaignId'),
            'source' => $this->f('source'),
            'to' => $this->f('to'),
            'operator' => $this->f('operator'),
            'senderValue' => $this->f('senderValue'),
            'senderType' => $this->f('senderType'),
            'smsType' => $this->f('smsType'),
            'body' => $this->f('body'),
            'encoding' => $this->f('encoding'),
            'segments' => $this->f('segments'),
            'unitPrice' => $this->money('unitPrice', 4),
            'cost' => $this->money('cost'),
            'status' => $this->f('status'),
            'provider' => $this->f('provider'),
            'errorCode' => $this->f('errorCode'),
            'errorMessage' => $this->f('errorMessage'),
            'clientReference' => $this->f('clientReference'),
            'queuedAt' => $this->date('queuedAt'),
            'submittedAt' => $this->date('submittedAt'),
            'deliveredAt' => $this->date('deliveredAt'),
            'failedAt' => $this->date('failedAt'),
            'refundedAt' => $this->date('refundedAt'),
            'createdAt' => $this->date('createdAt'),
            'campaign' => $this->whenLoaded('campaign', fn () => $this->campaign ? ['id' => $this->campaign->id, 'name' => $this->campaign->name] : null),
            'apiKey' => $this->whenLoaded('apiKey', fn () => $this->apiKey ? ['name' => $this->apiKey->name, 'prefix' => $this->apiKey->prefix] : null),
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? ['id' => $this->organization->id, 'name' => $this->organization->name] : null),
            'events' => $this->whenLoaded('events', fn () => $this->events->map(fn ($e) => [
                'id' => $e->id, 'status' => $e->status->value, 'providerStatus' => $e->providerStatus, 'description' => $e->description,
                'source' => $e->source->value, 'occurredAt' => Dhaka::iso($e->occurredAt),
            ])->values()),
        ];
    }
}
