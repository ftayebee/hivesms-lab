<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

/**
 * The /api/v1 JSON envelope (identical to the Next.js implementation, which customers integrate with):
 *   success: { "success": true,  "data": …, "meta": { "requestId": "req_…" } }
 *   error:   { "success": false, "error": { "code", "message", "details"? }, "meta": { "requestId" } }
 */
class ApiResponse
{
    public const REQUEST_ID_ATTRIBUTE = 'requestId';

    public static function requestId(): string
    {
        $request = request();
        $id = $request->attributes->get(self::REQUEST_ID_ATTRIBUTE);
        if (! is_string($id)) {
            $id = 'req_'.Str::random(16);
            $request->attributes->set(self::REQUEST_ID_ATTRIBUTE, $id);
        }

        return $id;
    }

    /** @param array<string, mixed> $meta */
    public static function ok(mixed $data = null, int $status = 200, array $meta = []): JsonResponse
    {
        return self::json(['success' => true, 'data' => $data, 'meta' => ['requestId' => self::requestId()] + $meta], $status);
    }

    public static function fail(ErrorCode $code, string $message, ?int $status = null, mixed $details = null): JsonResponse
    {
        $error = ['code' => $code->value, 'message' => $message];
        if ($details !== null) {
            $error['details'] = $details;
        }

        return self::json(['success' => false, 'error' => $error, 'meta' => ['requestId' => self::requestId()]], $status ?? $code->status());
    }

    /** @param array<string, mixed> $body */
    private static function json(array $body, int $status): JsonResponse
    {
        return response()->json($body, $status, [
            'X-Request-Id' => self::requestId(),
            'Cache-Control' => 'no-store',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
