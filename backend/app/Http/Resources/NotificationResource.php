<?php

namespace App\Http\Resources;

class NotificationResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'type' => $this->f('type'),
            'title' => $this->f('title'),
            'body' => $this->f('body'),
            'link' => $this->f('link'),
            'readAt' => $this->date('readAt'),
            'createdAt' => $this->date('createdAt'),
        ];
    }
}
