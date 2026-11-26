<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Api\V1\ApiController;
use App\Models\ReportImport;
use App\Services\Admin\PrivilegedActionGuard;
use App\Services\Report\ReportImportService;
use App\Support\Dhaka;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Report import (docs/24). Behind `feature:report_import` and `platform:admin:reports:import`
 * (SUPER_ADMIN). Template → preview (writes nothing) → import (password re-confirmed; may charge
 * the customer's wallet).
 */
class AdminReportImportController extends ApiController
{
    public function __construct(private readonly ReportImportService $imports, private readonly PrivilegedActionGuard $guard) {}

    /** GET /admin/report-imports/template */
    public function template(): Response
    {
        return response(ReportImportService::templateCsv(), 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="sms-report-import-template.csv"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** GET /admin/report-imports?organizationId=&page= */
    public function index(Request $request): JsonResponse
    {
        $f = $request->validate(['organizationId' => ['nullable', 'uuid']]);
        $page = $this->imports->list($f['organizationId'] ?? null, $this->page($request));

        return $this->ok(array_map(fn (ReportImport $i) => $this->present($i), $page->items()), 200, [
            'page' => $page->currentPage(), 'pageSize' => $page->perPage(), 'total' => $page->total(), 'totalPages' => $page->lastPage(),
        ]);
    }

    /** POST /admin/report-imports/preview (multipart: organizationId, file) */
    public function preview(Request $request): JsonResponse
    {
        $v = $request->validate(['organizationId' => ['required', 'uuid'], 'file' => ['required', 'file']], [
            'organizationId.required' => 'Choose the customer.', 'file.required' => 'Choose a CSV file.',
        ]);

        return $this->ok($this->imports->preview($v['organizationId'], $request->file('file')));
    }

    /** POST /admin/report-imports (multipart: organizationId, file, chargeWallet, note, currentPassword) */
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'organizationId' => ['required', 'uuid'],
            'file' => ['required', 'file'],
            'chargeWallet' => ['nullable', 'boolean'],
            'note' => ['nullable', 'string', 'max:500'],
            'currentPassword' => ['required', 'string', 'max:200'],
        ], ['organizationId.required' => 'Choose the customer.', 'file.required' => 'Choose a CSV file.', 'currentPassword.required' => 'Confirm with your current password.']);
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $v['currentPassword']);
        $r = $this->imports->import($admin, $v['organizationId'], $request->file('file'), $request->boolean('chargeWallet'), isset($v['note']) ? trim($v['note']) : null);
        $charged = $r['import']->charged;
        $message = "Imported {$r['import']->importedCount} messages".($r['import']->skippedCount ? ", skipped {$r['import']->skippedCount}" : '')
            .($charged ? '. '.Money::formatBdt((string) $r['import']->totalCost).' charged to the wallet.' : '. The wallet was not charged.');

        return $this->ok(['import' => $this->present($r['import']), 'summary' => $r['summary'], 'message' => $message], 201);
    }

    /** @return array<string, mixed> */
    private function present(ReportImport $i): array
    {
        return [
            'id' => $i->id,
            'organization' => $i->organization ? ['id' => $i->organization->id, 'name' => $i->organization->name] : ['id' => $i->organizationId, 'name' => null],
            'createdBy' => $i->createdBy ? ['id' => $i->createdBy->id, 'name' => $i->createdBy->name] : null,
            'fileName' => $i->fileName,
            'rowCount' => $i->rowCount,
            'importedCount' => $i->importedCount,
            'skippedCount' => $i->skippedCount,
            'segments' => $i->segments,
            'totalCost' => Money::round((string) $i->totalCost, 2),
            'charged' => $i->charged,
            'walletTransactionId' => $i->walletTransactionId,
            'firstSentAt' => Dhaka::iso($i->firstSentAt),
            'lastSentAt' => Dhaka::iso($i->lastSentAt),
            'note' => $i->note,
            'createdAt' => Dhaka::iso($i->createdAt),
        ];
    }
}
