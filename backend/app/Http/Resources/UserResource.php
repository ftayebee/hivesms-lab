<?php

namespace App\Http\Resources;

/** The signed-in user (never includes passwordHash, lockout counters or tokens). */
class UserResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'name' => $this->f('name'),
            'email' => $this->f('email'),
            'phone' => $this->f('phone'),
            'platformRole' => $this->f('platformRole'),
            'status' => $this->f('status'),
            'locale' => $this->f('locale'),
            'emailVerifiedAt' => $this->date('emailVerifiedAt'),
            'phoneVerifiedAt' => $this->date('phoneVerifiedAt'),
            'lastLoginAt' => $this->date('lastLoginAt'),
            'createdAt' => $this->date('createdAt'),
            'organizations' => $this->whenLoaded('memberships', fn () => $this->memberships->map(fn ($m) => $m->organization ? ['id' => $m->organization->id, 'name' => $m->organization->name] : null)->filter()->values()),
        ];
    }
}
