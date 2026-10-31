<?php

namespace App\Http\Resources;

/** Internal staff notes are filtered out by the customer query; staff views include them (isInternal). */
class SupportTicketResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'number' => $this->f('number'),
            'subject' => $this->f('subject'),
            'category' => $this->f('category'),
            'priority' => $this->f('priority'),
            'status' => $this->f('status'),
            'lastReplyAt' => $this->date('lastReplyAt'),
            'closedAt' => $this->date('closedAt'),
            'createdAt' => $this->date('createdAt'),
            'messageCount' => $this->when($this->loaded('messages_count'), fn () => (int) $this->messages_count),
            'createdBy' => $this->whenLoaded('createdBy', fn () => $this->createdBy ? array_filter([
                'id' => $this->createdBy->id, 'name' => $this->createdBy->name, 'email' => $this->createdBy->getAttributes()['email'] ?? null,
            ], fn ($v) => $v !== null) : null),
            'assignedTo' => $this->whenLoaded('assignedTo', fn () => $this->assignedTo ? ['id' => $this->assignedTo->id, 'name' => $this->assignedTo->name] : null),
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? ['id' => $this->organization->id, 'name' => $this->organization->name] : null),
            'messages' => $this->whenLoaded('messages', fn () => SupportMessageResource::collection($this->messages)->resolve($request)),
        ];
    }
}
