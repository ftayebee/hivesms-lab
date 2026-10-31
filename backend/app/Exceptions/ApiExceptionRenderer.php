<?php

namespace App\Exceptions;

use App\Support\ApiResponse;
use App\Support\ErrorCode;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Throwable;

/**
 * Renders every exception on /api/* as the API envelope. Unexpected errors are logged by the
 * framework and answered with a generic message: no SQL, stack traces or internals in responses.
 */
class ApiExceptionRenderer
{
    public static function handles(Request $request): bool
    {
        return $request->is('api/*');
    }

    public static function render(Throwable $e, Request $request): ?JsonResponse
    {
        if (! self::handles($request)) {
            return null;
        }

        return match (true) {
            $e instanceof AppException => ApiResponse::fail(
                $e->errorCode,
                $e->expose ? $e->getMessage() : 'The request could not be completed.',
                $e->status(),
                $e->details,
            ),
            $e instanceof ValidationException => ApiResponse::fail(ErrorCode::VALIDATION_ERROR, 'The request is invalid.', 422, [
                'fields' => collect($e->errors())
                    ->flatMap(fn (array $messages, string $path) => array_map(fn (string $m) => ['path' => $path, 'message' => $m], $messages))
                    ->values()
                    ->all(),
            ]),
            $e instanceof AuthenticationException => ApiResponse::fail(ErrorCode::UNAUTHORIZED, 'Authentication required.'),
            $e instanceof AuthorizationException, $e instanceof AccessDeniedHttpException => ApiResponse::fail(ErrorCode::FORBIDDEN, 'You do not have permission to perform this action.'),
            $e instanceof ModelNotFoundException, $e instanceof NotFoundHttpException => ApiResponse::fail(ErrorCode::NOT_FOUND, 'Resource not found.'),
            $e instanceof MethodNotAllowedHttpException => ApiResponse::fail(ErrorCode::INVALID_REQUEST, 'This HTTP method is not supported for this endpoint.', 405),
            $e instanceof ThrottleRequestsException => self::withHeaders(
                ApiResponse::fail(ErrorCode::RATE_LIMITED, 'Too many requests. Slow down and retry later.'),
                $e->getHeaders(),
            ),
            $e instanceof HttpExceptionInterface && $e->getStatusCode() < 500 => ApiResponse::fail(ErrorCode::INVALID_REQUEST, 'The request could not be processed.', $e->getStatusCode()),
            default => ApiResponse::fail(ErrorCode::INTERNAL_ERROR, 'Something went wrong on our side. Retry, and contact support if it persists.', 500),
        };
    }

    /** @param array<string, string> $headers */
    private static function withHeaders(JsonResponse $response, array $headers): JsonResponse
    {
        $response->headers->add($headers);

        return $response;
    }
}
