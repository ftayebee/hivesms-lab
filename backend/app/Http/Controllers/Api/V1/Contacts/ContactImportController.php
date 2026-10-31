<?php

namespace App\Http\Controllers\Api\V1\Contacts;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Contacts\ImportContactsRequest;
use App\Services\Contact\ContactImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CSV import. Small files return the result immediately (200, status "completed"); large files
 * are queued (202, status "queued") — poll GET /app/contacts/imports/{importId}.
 */
class ContactImportController extends ApiController
{
    public function __construct(private readonly ContactImportService $imports) {}

    public function store(ImportContactsRequest $request): JsonResponse
    {
        $r = $this->imports->start($this->tenant($request), $request->file('file'), $request->options());

        return $this->ok($r, $r['status'] === 'completed' ? 200 : 202);
    }

    public function show(Request $request, string $importId): JsonResponse
    {
        return $this->ok($this->imports->status($this->tenant($request), $importId));
    }
}
