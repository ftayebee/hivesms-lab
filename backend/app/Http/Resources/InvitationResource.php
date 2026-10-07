<?php

namespace App\Http\Resources;

/** Never includes the token hash. */
class InvitationResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'email' => $this->f('email'),
            'expiresAt' => $this->date('expiresAt'),
            'createdAt' => $this->date('createdAt'),
            'role' => $this->whenLoaded('role', fn () => $this->role ? array_filter(['key' => $this->role->getAttributes()['key'] ?? null, 'name' => $this->role->name], fn ($v) => $v !== null) : null),
        ];
    }
}
