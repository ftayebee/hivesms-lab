<?php

namespace App\Http\Requests\Messaging;

use App\Http\Requests\ApiRequest;

/** Sender ID request (multipart: fields + up to 3 "documents[]" files: PDF/PNG/JPG ≤ 5 MB). */
class SenderIdRequest extends ApiRequest
{
    public function rules(): array
    {
        return [
            'value' => ['required', 'string', 'min:3', 'max:15'],
            'type' => ['required', 'in:MASKING,NON_MASKING'],
            'purpose' => ['required', 'string', 'min:10', 'max:500'],
            'sampleMessage' => ['required', 'string', 'min:10', 'max:500'],
            'documents' => ['nullable', 'array', 'max:3'],
            'documents.*' => ['file', 'max:5120', 'mimes:pdf,png,jpg,jpeg'],
        ];
    }

    public function messages(): array
    {
        return [
            'value.min' => 'Sender IDs are at least 3 characters.',
            'purpose.*' => 'Describe what you will send (at least 10 characters).',
            'sampleMessage.*' => 'Add a sample message.',
            'documents.max' => 'Attach at most 3 documents.',
            'documents.*.max' => 'Documents must be at most 5 MB.',
            'documents.*.mimes' => 'Only PDF, PNG or JPG files are accepted.',
        ];
    }

    /** @return array{value: string, type: string, purpose: string, sampleMessage: string} */
    public function payload(): array
    {
        return [
            'value' => strtoupper(trim($this->input('value'))),
            'type' => $this->input('type'),
            'purpose' => trim($this->input('purpose')),
            'sampleMessage' => trim($this->input('sampleMessage')),
        ];
    }
}
