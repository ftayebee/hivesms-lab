<?php

use App\Exceptions\ApiExceptionRenderer;
use App\Exceptions\AppException;
use App\Http\Middleware\AssignRequestContext;
use App\Http\Middleware\AuthenticateApiKey;
use App\Http\Middleware\AuthenticateSession;
use App\Http\Middleware\Idempotency;
use App\Http\Middleware\RateLimit;
use App\Http\Middleware\RequirePlatformPermission;
use App\Http\Middleware\RequireVerifiedEmail;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Trusted proxies are applied in AppServiceProvider from config (TRUSTED_PROXIES).
        $middleware->api(prepend: [AssignRequestContext::class]);
        $middleware->alias([
            'auth.session' => AuthenticateSession::class,
            'tenant' => ResolveTenant::class,
            'platform' => RequirePlatformPermission::class,
            'api.key' => AuthenticateApiKey::class,
            'idempotent' => Idempotency::class,
            'ratelimit' => RateLimit::class,
            'verified.email' => RequireVerifiedEmail::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Every /api/* error uses the API envelope, whatever the Accept header says.
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => ApiExceptionRenderer::handles($request) || $request->expectsJson());
        $exceptions->render(fn (Throwable $e, Request $request) => ApiExceptionRenderer::render($e, $request));
        // Expected business errors are not application failures: keep them out of the error log.
        $exceptions->dontReport([AppException::class]);
        // Never log request input that could contain credentials.
        $exceptions->dontFlash(['password', 'confirmPassword', 'currentPassword', 'token', 'apiKey', 'apiSecret', 'webhookSecret', 'sslStorePassword']);
    })->create();
