<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use App\Http\RequestContext;
use App\Models\ApiLog;
use App\Services\ApiKey\ApiKeyAuthenticator;
use App\Services\Platform\RateLimiter;
use App\Support\ApiResponse;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Public customer API authentication (`api.key:<scope>,…`), separate from dashboard sessions.
 * Validates the key (hash lookup, revoked, expired, IP allowlist, organization status), enforces
 * scopes, throttles authentication failures per IP, and logs every authenticated request to
 * api_logs after the response is sent (status, duration, error code — never bodies or keys).
 */
class AuthenticateApiKey
{
    private const ERRORS = [
        'missing' => ['Missing API key. Send it as: Authorization: Bearer <key>', ErrorCode::INVALID_API_KEY],
        'invalid' => ['Invalid API key.', ErrorCode::INVALID_API_KEY],
        'revoked' => ['This API key has been revoked.', ErrorCode::INVALID_API_KEY],
        'expired' => ['This API key has expired.', ErrorCode::INVALID_API_KEY],
        'ip_not_allowed' => ['Requests from this IP address are not allowed for this API key.', ErrorCode::FORBIDDEN],
        'org_suspended' => ['This account is suspended.', ErrorCode::FORBIDDEN],
    ];

    public function __construct(private readonly ApiKeyAuthenticator $auth, private readonly RateLimiter $limiter) {}

    public function handle(Request $request, Closure $next, string ...$scopes): Response
    {
        $started = microtime(true);
        $ip = RequestContext::ip($request);
        $result = $this->auth->authenticate($request->header('Authorization'), $ip, RequestContext::userAgent($request));
        if (is_string($result)) {
            $this->limiter->hit("api-auth-fail:{$ip}", RateLimiter::rule('api_auth_failures_per_ip'));
            [$message, $code] = self::ERRORS[$result];

            return ApiResponse::fail($code, $message, $code === ErrorCode::FORBIDDEN ? 403 : 401);
        }
        $request->attributes->set(RequestContext::TENANT, $result['ctx']);
        $request->attributes->set(RequestContext::API_KEY_ID, $result['apiKeyId']);
        $request->attributes->set(RequestContext::API_SCOPES, $result['scopes']);

        $response = null;
        try {
            $missing = array_values(array_diff($scopes, $result['scopes']));
            if ($missing) {
                throw new AppException(ErrorCode::INSUFFICIENT_SCOPE, 'This API key is missing the required scope: '.implode(', ', $missing).'.');
            }
            $response = $next($request);

            return $response;
        } catch (Throwable $e) {
            // Render here so the log below sees the real status code.
            $response = app(ExceptionHandler::class)->render($request, $e);
            if (! $e instanceof AppException && ! $e instanceof ValidationException) {
                report($e);
            }

            return $response;
        } finally {
            $this->log($request, $response, $result, $started);
        }
    }

    private function log(Request $request, ?Response $response, array $auth, float $started): void
    {
        $status = $response?->getStatusCode() ?? 500;
        $errorCode = null;
        if ($status >= 400 && $response instanceof JsonResponse) {
            $errorCode = $response->getData(true)['error']['code'] ?? null;
        }
        $row = [
            'organizationId' => $auth['ctx']->organizationId,
            'apiKeyId' => $auth['apiKeyId'],
            'requestId' => ApiResponse::requestId(),
            'method' => $request->method(),
            'path' => '/'.ltrim($request->path(), '/'),
            'statusCode' => $status,
            'durationMs' => (int) round((microtime(true) - $started) * 1000),
            'errorCode' => $errorCode,
            'ipAddress' => RequestContext::ip($request),
            'userAgent' => mb_substr((string) $request->userAgent(), 0, 300) ?: null,
        ];
        $request->attributes->set(self::LOG_ATTRIBUTE, $row);
    }

    private const LOG_ATTRIBUTE = 'smsflow.apiLog';

    /** Written after the response was sent (best effort, never fails the request). */
    public function terminate(Request $request, Response $response): void
    {
        $row = $request->attributes->get(self::LOG_ATTRIBUTE);
        if (! is_array($row)) {
            return;
        }
        $request->attributes->remove(self::LOG_ATTRIBUTE);
        try {
            ApiLog::query()->forceCreate($row);
        } catch (Throwable $e) {
            Log::error('api log write failed', ['error' => $e->getMessage()]);
        }
    }
}
