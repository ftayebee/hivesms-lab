<?php

namespace App\Http\Resources;

class SuppressionEntryResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'phone' => $this->f('phone'),
            'reason' => $this->f('reason'),
            'source' => $this->f('source'),
            'note' => $this->f('note'),
            'createdAt' => $this->date('createdAt'),
        ];
    }
}
