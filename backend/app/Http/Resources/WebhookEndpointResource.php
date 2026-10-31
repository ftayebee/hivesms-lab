<?php

namespace App\Http\Resources;

use App\Support\Dhaka;

/** Never includes the (encrypted) signing secret; it is shown once, at creation. */
class WebhookEndpointResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'url' => $this->f('url'),
            'description' => $this->f('description'),
            'events' => $this->f('events'),
            'active' => $this->f('active'),
            'failureCount' => $this->f('failureCount'),
            'lastDeliveryAt' => $this->date('lastDeliveryAt'),
            'lastStatusCode' => $this->f('lastStatusCode'),
            'createdAt' => $this->date('createdAt'),
            'deliveries' => $this->whenLoaded('deliveries', fn () => $this->deliveries->map(fn ($d) => [
                'id' => $d->id, 'event' => $d->event, 'status' => $d->status->value, 'responseStatus' => $d->responseStatus,
                'attempts' => $d->attempts, 'createdAt' => Dhaka::iso($d->createdAt),
            ])->values()),
        ];
    }
}
