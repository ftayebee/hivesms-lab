<?php

namespace App\Http\Resources;

class ContactGroupResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'name' => $this->f('name'),
            'description' => $this->f('description'),
            'count' => $this->when($this->loaded('contactsCount'), fn () => (int) $this->contactsCount),
            'createdAt' => $this->date('createdAt'),
        ];
    }
}
