<?php

namespace App\Http\Resources;

class AuditLogResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'organizationId' => $this->f('organizationId'),
            'actorType' => $this->f('actorType'),
            'actorUserId' => $this->f('actorUserId'),
            'actorApiKeyId' => $this->f('actorApiKeyId'),
            'action' => $this->f('action'),
            'targetType' => $this->f('targetType'),
            'targetId' => $this->f('targetId'),
            'ipAddress' => $this->f('ipAddress'),
            'metadata' => $this->f('metadata'),
            'createdAt' => $this->date('createdAt'),
            'actor' => $this->whenLoaded('actor', fn () => $this->actor ? ['id' => $this->actor->id, 'name' => $this->actor->name] : null),
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? ['id' => $this->organization->id, 'name' => $this->organization->name] : null),
        ];
    }
}
