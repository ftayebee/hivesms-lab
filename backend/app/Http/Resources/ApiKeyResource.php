<?php

namespace App\Http\Resources;

/** Never includes keyHash. The full key is returned exactly once, by the create endpoint. */
class ApiKeyResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'name' => $this->f('name'),
            'prefix' => $this->f('prefix'),
            'scopes' => $this->f('scopes'),
            'ipAllowlist' => $this->f('ipAllowlist'),
            'status' => $this->f('status'),
            'lastUsedAt' => $this->date('lastUsedAt'),
            'lastUsedIp' => $this->f('lastUsedIp'),
            'expiresAt' => $this->date('expiresAt'),
            'revokedAt' => $this->date('revokedAt'),
            'createdAt' => $this->date('createdAt'),
        ];
    }
}
