<?php

namespace App\Http\Resources;

class SupportMessageResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'body' => $this->f('body'),
            'isStaff' => $this->f('isStaff'),
            'isInternal' => $this->f('isInternal'),
            'createdAt' => $this->date('createdAt'),
            'author' => $this->whenLoaded('author', fn () => $this->author ? ['id' => $this->author->id, 'name' => $this->author->name] : null),
        ];
    }
}
