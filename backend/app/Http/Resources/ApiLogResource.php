<?php

namespace App\Http\Resources;

class ApiLogResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'requestId' => $this->f('requestId'),
            'method' => $this->f('method'),
            'path' => $this->f('path'),
            'statusCode' => $this->f('statusCode'),
            'durationMs' => $this->f('durationMs'),
            'errorCode' => $this->f('errorCode'),
            'ipAddress' => $this->f('ipAddress'),
            'userAgent' => $this->f('userAgent'),
            'createdAt' => $this->date('createdAt'),
            'apiKey' => $this->whenLoaded('apiKey', fn () => $this->apiKey ? ['name' => $this->apiKey->name, 'prefix' => $this->apiKey->prefix] : null),
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? ['id' => $this->organization->id, 'name' => $this->organization->name] : null),
        ];
    }
}
