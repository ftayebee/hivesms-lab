<?php

namespace App\Http\Controllers\Api\V1;

use App\Auth\AdminContext;
use App\Auth\ResolvedSession;
use App\Auth\TenantContext;
use App\Http\Controllers\Controller;
use App\Http\RequestContext;
use App\Support\ApiResponse;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Base for API controllers. Controllers only orchestrate: resolve identity, pass validated input
 * to a service, wrap the result in the envelope. Business rules live in app/Services.
 */
abstract class ApiController extends Controller
{
    protected function tenant(Request $request): TenantContext
    {
        return RequestContext::tenant($request);
    }

    protected function session(Request $request): ResolvedSession
    {
        return RequestContext::session($request);
    }

    protected function admin(Request $request): AdminContext
    {
        return RequestContext::admin($request);
    }

    protected function ok(mixed $data = null, int $status = 200, array $meta = []): JsonResponse
    {
        return ApiResponse::ok($data, $status, $meta);
    }

    /**
     * Paginated list: data = resource array, meta = {page, pageSize, total, totalPages} (+ extra).
     *
     * @param  class-string<JsonResource>  $resource
     */
    protected function paginated(Request $request, LengthAwarePaginator $page, string $resource, array $meta = []): JsonResponse
    {
        return ApiResponse::ok($resource::collection($page->getCollection())->resolve($request), 200, [
            'page' => $page->currentPage(),
            'pageSize' => $page->perPage(),
            'total' => $page->total(),
            'totalPages' => $page->lastPage(),
        ] + $meta);
    }

    /** @param class-string<JsonResource> $resource */
    protected function resource(Request $request, string $resource, mixed $model, int $status = 200, array $meta = []): JsonResponse
    {
        return ApiResponse::ok((new $resource($model))->resolve($request), $status, $meta);
    }

    /** @param class-string<JsonResource> $resource */
    protected function collection(Request $request, string $resource, iterable $items, array $meta = []): JsonResponse
    {
        return ApiResponse::ok($resource::collection(collect($items))->resolve($request), 200, $meta);
    }

    /** Streams a CSV download; $produce(callable $write) writes chunks (never the whole file in memory). */
    protected function csv(string $name, callable $produce): StreamedResponse
    {
        $safe = trim(preg_replace('/[^a-z0-9-]+/', '-', strtolower($name)) ?? 'export', '-') ?: 'export';
        $file = $safe.'-'.now()->format('Y-m-d').'.csv';

        return response()->streamDownload(function () use ($produce) {
            $produce(function (string $chunk) {
                echo $chunk;
                if (ob_get_level() > 0) {
                    ob_flush();
                }
                flush();
            });
        }, $file, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Request-Id' => ApiResponse::requestId(),
        ]);
    }

    protected function page(Request $request): int
    {
        $p = (int) $request->query('page', 1);

        return max(1, min(10000, $p));
    }
}
