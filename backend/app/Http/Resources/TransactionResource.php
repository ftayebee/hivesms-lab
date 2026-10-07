<?php

namespace App\Http\Resources;

class TransactionResource extends BaseResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->f('id'),
            'type' => $this->f('type'),
            'reason' => $this->f('reason'),
            'amount' => $this->money('amount'),
            'balanceAfter' => $this->money('balanceAfter'),
            'description' => $this->f('description'),
            'referenceType' => $this->f('referenceType'),
            'referenceId' => $this->f('referenceId'),
            'createdAt' => $this->date('createdAt'),
        ];
    }
}
