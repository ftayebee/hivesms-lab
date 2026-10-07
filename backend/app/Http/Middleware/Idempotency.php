<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use App\Http\RequestContext;
use App\Models\IdempotencyKey;
use App\Support\Crypto;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `Idempotency-Key` support for endpoints that charge or send (port of the handler in
 * src/lib/api/handler.ts). Per organization, for 24 h:
 *  - same key + same request → the stored response is replayed (header Idempotent-Replayed: true);
 *    nothing is charged or sent again;
 *  - same key + different body → 409 IDEMPOTENCY_CONFLICT;
 *  - same key while the first request is still running → 409 CONFLICT.
 * The key row is inserted first (unique (organizationId, key)), so concurrent retries race on the
 * database constraint, not in application code. Failed requests release the key.
 */
class Idempotency
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');
        $ctx = RequestContext::maybeTenant($request);
        if ($key === null || $key === '' || ! $ctx) {
            return $next($request);
        }
        if (strlen($key) > 255) {
            throw new AppException(ErrorCode::INVALID_REQUEST, 'Idempotency-Key must be at most 255 characters.');
        }
        $requestHash = Crypto::sha256($request->method().':/'.ltrim($request->path(), '/').':'.$request->getContent());
        $existing = IdempotencyKey::query()->where('organizationId', $ctx->organizationId)->where('key', $key)->first();
        if ($existing) {
            return $this->replay($existing, $requestHash);
        }
        try {
            $row = IdempotencyKey::query()->forceCreate([
                'organizationId' => $ctx->organizationId, 'key' => $key, 'requestHash' => $requestHash, 'expiresAt' => now()->addDay(),
            ]);
        } catch (UniqueConstraintViolationException) {
            throw new AppException(ErrorCode::CONFLICT, 'A request with this Idempotency-Key is still being processed.');
        }

        try {
            $response = $next($request);
        } catch (\Throwable $e) {
            $row->delete();
            throw $e;
        }
        // Only successful responses are stored; errors release the key so a corrected retry (e.g.
        // after topping up the wallet) is processed fresh — same as the Node implementation.
        $payload = $response instanceof JsonResponse ? $response->getData(true) : null;
        if ($response->isSuccessful() && $payload !== null) {
            $row->forceFill(['response' => $payload, 'statusCode' => $response->getStatusCode()])->save();
        } else {
            $row->delete();
        }

        return $response;
    }

    private function replay(IdempotencyKey $existing, string $requestHash): Response
    {
        if (! hash_equals($existing->requestHash, $requestHash)) {
            throw new AppException(ErrorCode::IDEMPOTENCY_CONFLICT, 'This Idempotency-Key was already used with a different request body.');
        }
        if ($existing->response === null) {
            throw new AppException(ErrorCode::CONFLICT, 'A request with this Idempotency-Key is still being processed.');
        }

        return response()->json($existing->response, $existing->statusCode ?? 200, ['Idempotent-Replayed' => 'true', 'Cache-Control' => 'no-store'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
