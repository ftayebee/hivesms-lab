<?php

namespace App\Http\Resources;

class CampaignResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'name' => $this->f('name'),
            'smsType' => $this->f('smsType'),
            'senderIdId' => $this->f('senderIdId'),
            'senderValue' => $this->f('senderValue'),
            'senderType' => $this->f('senderType'),
            'templateId' => $this->f('templateId'),
            'message' => $this->f('message'),
            'encoding' => $this->f('encoding'),
            'segmentsPerMessage' => $this->f('segmentsPerMessage'),
            'status' => $this->f('status'),
            'audience' => $this->when($this->loaded('audience'), fn () => [
                'groupIds' => array_values((array) ($this->audience['groupIds'] ?? [])),
                'numbers' => array_values((array) ($this->audience['numbers'] ?? [])),
            ]),
            'scheduledAt' => $this->date('scheduledAt'),
            'startedAt' => $this->date('startedAt'),
            'completedAt' => $this->date('completedAt'),
            'pausedAt' => $this->date('pausedAt'),
            'cancelledAt' => $this->date('cancelledAt'),
            'recipientCount' => $this->f('recipientCount'),
            'skippedCount' => $this->f('skippedCount'),
            'queuedCount' => $this->f('queuedCount'),
            'submittedCount' => $this->f('submittedCount'),
            'deliveredCount' => $this->f('deliveredCount'),
            'failedCount' => $this->f('failedCount'),
            'estimatedCost' => $this->money('estimatedCost'),
            'actualCost' => $this->money('actualCost'),
            'refundedAmount' => $this->money('refundedAmount'),
            'failureReason' => $this->f('failureReason'),
            'reviewNote' => $this->f('reviewNote'),
            'reviewedAt' => $this->date('reviewedAt'),
            'createdById' => $this->f('createdById'),
            'createdAt' => $this->date('createdAt'),
            'updatedAt' => $this->date('updatedAt'),
            'template' => $this->whenLoaded('template', fn () => $this->template ? ['id' => $this->template->id, 'name' => $this->template->name] : null),
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? ['id' => $this->organization->id, 'name' => $this->organization->name] : null),
        ];
    }
}
