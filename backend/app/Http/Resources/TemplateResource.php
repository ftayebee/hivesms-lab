<?php

namespace App\Http\Resources;

use App\Services\Sms\MessageSegmentCalculator;

class TemplateResource extends BaseResource
{
    public function toArray($request): array
    {
        $seg = $this->loaded('body') ? MessageSegmentCalculator::calculate((string) $this->body) : null;

        return [
            'id' => $this->f('id'),
            'name' => $this->f('name'),
            'body' => $this->f('body'),
            'smsType' => $this->f('smsType'),
            'variables' => $this->when($seg !== null, fn () => MessageSegmentCalculator::extractVariables((string) $this->body)),
            'encoding' => $this->when($seg !== null, fn () => $seg['encoding']),
            'segments' => $this->when($seg !== null, fn () => $seg['segments']),
            'createdAt' => $this->date('createdAt'),
            'updatedAt' => $this->date('updatedAt'),
        ];
    }
}
