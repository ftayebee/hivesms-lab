<?php

namespace App\Http\Requests\Contacts;

use App\Http\Requests\ApiRequest;

/** Bulk action on up to 1,000 contacts: delete | addToGroup | removeFromGroup | addTag | setConsent. */
class BulkContactsRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'min:1', 'max:1000'],
            'ids.*' => ['uuid'],
            'action' => ['required', 'array'],
            'action.type' => ['required', 'in:delete,addToGroup,removeFromGroup,addTag,setConsent'],
            'action.groupId' => ['required_if:action.type,addToGroup,removeFromGroup', 'nullable', 'uuid'],
            'action.tag' => ['required_if:action.type,addTag', 'nullable', 'string', 'min:1', 'max:40'],
            'action.consent' => ['required_if:action.type,setConsent', 'nullable', 'in:OPTED_IN,UNKNOWN,OPTED_OUT'],
        ];
    }
}
