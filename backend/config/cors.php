<?php

/*
 * CORS for browser calls to the API. Only the Next.js frontend origin(s) are allowed.
 * Customers call the SMS API server-to-server, which CORS does not affect, and the Next.js
 * server calls the API server-to-server as well. Authentication uses Bearer tokens, not
 * cookies, so credentials are not allowed cross-origin.
 *
 * FRONTEND_URL: comma-separated origins, e.g. "https://sms.hivelabsbd.com" or
 * "http://localhost:3000,http://127.0.0.1:3000".
 */
return [

    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_filter(array_map(
        fn (string $origin) => rtrim(trim($origin), '/'),
        explode(',', (string) env('FRONTEND_URL', 'http://localhost:3000')),
    ))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Requested-With'],

    'exposed_headers' => ['X-Request-Id', 'Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],

    'max_age' => 600,

    'supports_credentials' => false,

];
