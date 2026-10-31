<?php

namespace App\Http\Requests\Contacts;

use App\Http\Requests\ApiRequest;
use App\Rules\BdPhone;
use App\Support\Phone;

class SuppressionRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'phone' => ['required', 'string', new BdPhone],
            'reason' => ['nullable', 'in:OPT_OUT,MANUAL,COMPLAINT,INVALID'],
            'note' => ['nullable', 'string', 'max:300'],
        ];
    }

    /** @return array{phone: string, reason: string, note: ?string} */
    public function payload(): array
    {
        return ['phone' => Phone::normalize($this->input('phone')), 'reason' => $this->input('reason') ?: 'MANUAL', 'note' => $this->clean('note')];
    }
}
