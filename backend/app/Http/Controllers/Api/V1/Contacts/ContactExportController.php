<?php

namespace App\Http\Controllers\Api\V1\Contacts;

use App\Http\Controllers\Api\V1\ApiController;
use App\Services\Contact\ContactService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** GET /app/contacts/export: streamed CSV (same filters as the list), CSV-injection safe. */
class ContactExportController extends ApiController
{
    public function __construct(private readonly ContactService $contacts) {}

    public function __invoke(Request $request): StreamedResponse
    {
        $f = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'group' => ['nullable', 'uuid'],
            'tag' => ['nullable', 'string', 'max:40'],
            'consent' => ['nullable', 'in:OPTED_IN,UNKNOWN,OPTED_OUT'],
        ]);
        $ctx = $this->tenant($request);
        $ctx->requirePermission('contacts:export');

        return $this->csv('contacts', fn (callable $write) => $this->contacts->exportCsv($ctx, $f, $write));
    }
}
