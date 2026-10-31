<?php

namespace App\Http\Resources;

use App\Support\Dhaka;

class TeamMemberResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'userId' => $this->f('userId'),
            'status' => $this->f('status'),
            'joinedAt' => $this->date('joinedAt'),
            'user' => $this->whenLoaded('user', function () {
                if (! $this->user) {
                    return null;
                }
                $a = $this->user->getAttributes();

                return array_filter([
                    'id' => $this->user->id,
                    'name' => $this->user->name,
                    'email' => $this->user->email,
                    'lastLoginAt' => array_key_exists('lastLoginAt', $a) ? Dhaka::iso($this->user->lastLoginAt) : null,
                    'emailVerified' => array_key_exists('emailVerifiedAt', $a) ? $a['emailVerifiedAt'] !== null : null,
                    'status' => array_key_exists('status', $a) ? $this->user->status->value : null,
                ], fn ($v) => $v !== null);
            }),
            'role' => $this->whenLoaded('role', fn () => $this->role ? array_filter(['id' => $this->role->id, 'key' => $this->role->getAttributes()['key'] ?? null, 'name' => $this->role->getAttributes()['name'] ?? null], fn ($v) => $v !== null) : null),
        ];
    }
}
