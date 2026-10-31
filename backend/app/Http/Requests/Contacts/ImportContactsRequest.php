<?php

namespace App\Http\Requests\Contacts;

use App\Http\Requests\ApiRequest;

/**
 * CSV upload (multipart/form-data, field "file"). Size, extension and MIME are checked here; the
 * content (text, header, rows) is validated by the import service. The client file name is never
 * used for storage.
 */
class ImportContactsRequest extends ApiRequest
{
    public function rules(): array
    {
        $maxKb = (int) (config('smsflow.uploads.csv_max_bytes') / 1024);

        return [
            'file' => ['required', 'file', "max:{$maxKb}", 'extensions:csv,txt', 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel,text/x-csv,application/octet-stream'],
            'groupId' => ['nullable', 'uuid'],
            'defaultConsent' => ['nullable', 'in:OPTED_IN,UNKNOWN,OPTED_OUT'],
            'consentSource' => ['nullable', 'string', 'max:120'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'Choose a CSV file to import.',
            'file.max' => 'The file is larger than 10 MB. Split it into smaller files.',
            'file.extensions' => 'Upload a .csv file. To import from Excel, use File → Save As → CSV UTF-8.',
            'file.mimetypes' => 'This does not look like a text CSV file.',
        ];
    }

    /** @return array{groupId: ?string, defaultConsent: string, consentSource: ?string} */
    public function options(): array
    {
        return ['groupId' => $this->clean('groupId'), 'defaultConsent' => $this->input('defaultConsent') ?: 'UNKNOWN', 'consentSource' => $this->clean('consentSource')];
    }
}
