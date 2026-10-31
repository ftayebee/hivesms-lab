<?php

namespace App\Http\Resources;

use App\Http\RequestContext;

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
            // Platform ledger (admin) only.
            'organization' => $this->whenLoaded('organization', fn () => $this->organization ? ['id' => $this->organization->id, 'name' => $this->organization->name] : null),
            'createdById' => $this->when((bool) $request->attributes->get(RequestContext::ADMIN), fn () => $this->createdById),
        ];
    }
}
