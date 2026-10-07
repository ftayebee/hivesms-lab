<?php

namespace App\Http\Resources;

class ContactResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'name' => $this->f('name'),
            'phone' => $this->f('phone'),
            'email' => $this->f('email'),
            'company' => $this->f('company'),
            'tags' => $this->when($this->loaded('tags'), fn () => array_values((array) $this->tags)),
            'customFields' => $this->when($this->loaded('customFields'), fn () => (object) (array) $this->customFields),
            'consentStatus' => $this->f('consentStatus'),
            'consentSource' => $this->f('consentSource'),
            'consentAt' => $this->date('consentAt'),
            'createdAt' => $this->date('createdAt'),
            'updatedAt' => $this->date('updatedAt'),
            'groups' => $this->whenLoaded('contactGroups', fn () => $this->contactGroups->map(fn ($g) => ['id' => $g->id, 'name' => $g->name])->values()),
        ];
    }
}
