<?php

namespace App\Http\Requests\Billing;

use App\Http\Requests\ApiRequest;

class ManualReferenceRequest extends ApiRequest
{
    public function rules(): array
    {
        return ['reference' => ['required', 'string', 'min:4', 'max:100']];
    }

    public function messages(): array
    {
        return ['reference.*' => 'Enter the transaction or deposit reference.'];
    }
}
