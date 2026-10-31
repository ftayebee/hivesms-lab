<?php

/*
 * Application configuration (ports src/config/env.ts, config/sms.ts, config/pricing.ts and the rate
 * limits of src/lib/rate-limit.ts). Policies here are DEFAULTS: admins override them at runtime in
 * the `settings` table (sms.policy, billing.policy, sms.provider, payments), exactly as before.
 */
return [

    // Public URL of the Next.js app: links in emails, payment return redirects.
    'frontend_url' => rtrim(explode(',', (string) env('FRONTEND_URL', 'http://localhost:3000'))[0], '/'),

    // Shared secrets. MUST equal the Next.js app's values while both run on the same database.
    'auth_secret' => env('AUTH_SECRET', ''),
    'api_key_pepper' => env('API_KEY_PEPPER', ''),
    'settings_encryption_key' => env('SETTINGS_ENCRYPTION_KEY', ''),
    'cron_secret' => env('CRON_SECRET', ''),

    // Proxy in front of the app (Hostinger/Cloudflare/nginx): "*" or comma-separated IPs/CIDRs, so
    // $request->ip() is the real client (rate limits, API key IP allowlists, audit logs).
    'trusted_proxies' => env('TRUSTED_PROXIES'),

    // Shared secret of the Next.js server (BFF). With it, the Next.js server may pass the browser's IP
    // in X-SMSFlow-Client-IP so per-IP rate limits and audit logs see the real user, not the Next.js
    // host. Without the matching secret the header is ignored. At least 32 random characters.
    'frontend_proxy_secret' => env('FRONTEND_PROXY_SECRET', ''),

    // Shared hosting without Supervisor: the scheduler drains the queue every minute.
    'queue_worker_via_scheduler' => env('QUEUE_WORKER_VIA_SCHEDULER', true),

    'features' => [
        'registration_open' => env('FEATURE_REGISTRATION_OPEN', true),
        'phone_verification' => env('FEATURE_PHONE_VERIFICATION', false),
        // Simulated checkout. Never enable on a live site.
        'allow_mock_payments' => env('ALLOW_MOCK_PAYMENTS', false),
    ],

    'sessions' => [
        'ttl_days' => 7,
        'remember_ttl_days' => 30,
        'touch_interval_seconds' => 300,
    ],

    'sms' => [
        'provider' => env('SMS_PROVIDER', 'mock'),
        'provider_url' => env('SMS_PROVIDER_URL', ''),
        'provider_api_key' => env('SMS_PROVIDER_API_KEY', ''),
        'provider_api_secret' => env('SMS_PROVIDER_API_SECRET', ''),
        'provider_webhook_secret' => env('SMS_PROVIDER_WEBHOOK_SECRET', ''),
        'default_sender_id' => env('SMS_DEFAULT_SENDER_ID', '8809600000000'),
        'provider_timeout_seconds' => (int) env('SMS_PROVIDER_TIMEOUT', 15),
        // Dispatch small sends right after the HTTP response (the worker picks up anything left).
        'inline_dispatch' => env('SMS_INLINE_DISPATCH', true),
        'inline_dispatch_max' => 200,
        // Worker tick: max batches and time budget (seconds) for claiming new batches.
        'worker_batch_size' => (int) env('SMS_WORKER_BATCH_SIZE', 100),
        'worker_max_batches' => (int) env('SMS_WORKER_MAX_BATCHES', 20),
        'worker_budget_seconds' => (int) env('SMS_WORKER_BUDGET_SECONDS', 45),
        'lease_seconds' => 120,
    ],

    // Defaults of the admin-editable "sms.policy" setting (src/config/sms.ts).
    'sms_policy' => [
        'segmentation' => [
            'gsm7' => ['single' => 160, 'multipart' => 153],
            'ucs2' => ['single' => 70, 'multipart' => 67],
            'maxSegments' => 10,
        ],
        'refundFailedMessages' => true,
        'maxAttempts' => 4,
        'promotionalQuietHours' => ['start' => 21, 'end' => 9],
        'promotionalOptOutText' => 'Reply STOP to opt out',
        'appendOptOutText' => false,
        'reviewThresholdRecipients' => 5000,
        'optOutKeywords' => ['STOP', 'UNSUBSCRIBE', 'বন্ধ'],
        'maxBulkRecipients' => 1000,
        'maxCampaignRecipients' => 200000,
    ],

    // Defaults of the admin-editable "billing.policy" setting (src/config/pricing.ts).
    'billing_policy' => [
        'vatRatePercent' => 15,
        'pricesExcludeVat' => true,
        'minimumTopUp' => 500,
        'maximumTopUp' => 500000,
        'balanceValidityMonths' => 12,
        'invoicePrefix' => 'INV',
    ],

    'payments' => [
        // Enabled providers unless overridden by the "payments" setting.
        'providers' => env('PAYMENT_PROVIDERS', 'mock,manual'),
        'sslcommerz_store_id' => env('PAYMENT_PROVIDER_KEY', ''),
        'sslcommerz_store_password' => env('PAYMENT_PROVIDER_SECRET', ''),
        'sslcommerz_live' => env('PAYMENT_PROVIDER_LIVE', false),
        'manual_instructions' => 'Transfer the total amount to the account shown on your invoice, then submit the transaction reference below. Credits are added after our team verifies the payment.',
    ],

    // Fixed-window limits backed by rate_limit_buckets (shared with the Node app during the transition).
    'rate_limits' => [
        'login_per_ip' => ['limit' => 20, 'window' => 600],
        'login_per_account' => ['limit' => 10, 'window' => 600],
        'register_per_ip' => ['limit' => 5, 'window' => 3600],
        'password_reset_per_ip' => ['limit' => 5, 'window' => 3600],
        'otp_per_user' => ['limit' => 5, 'window' => 3600],
        'public_form_per_ip' => ['limit' => 5, 'window' => 600],
        'api_per_key' => ['limit' => (int) env('API_RATE_LIMIT_PER_MINUTE', 600), 'window' => 60],
        'api_send_per_key' => ['limit' => (int) env('API_SEND_RATE_LIMIT_PER_MINUTE', 120), 'window' => 60],
        'api_auth_failures_per_ip' => ['limit' => 30, 'window' => 300],
        'webhook_per_ip' => ['limit' => 1200, 'window' => 60],
        'dashboard_per_user' => ['limit' => (int) env('DASHBOARD_RATE_LIMIT_PER_MINUTE', 300), 'window' => 60],
        'dashboard_send_per_user' => ['limit' => 30, 'window' => 60],
        'admin_write_per_user' => ['limit' => 120, 'window' => 60],
        // Password confirmation for privileged admin actions: failed attempts per staff user.
        'admin_reauth_failures' => ['limit' => 5, 'window' => 900],
        // Privileged mutations (staff access, wallet adjustments, refunds, provider costs) per staff user.
        'admin_privileged_per_user' => ['limit' => 20, 'window' => 600],
    ],

    'uploads' => [
        'csv_max_bytes' => 10 * 1024 * 1024,
        'csv_max_rows' => 100000,
        // Imports larger than this many bytes are processed by a queued job.
        'csv_sync_max_bytes' => 512 * 1024,
        'document_max_bytes' => 5 * 1024 * 1024,
        'disk' => env('DOCUMENTS_DISK', 'local'),
    ],

    'site' => [
        'name' => env('APP_NAME', 'SMSFlow BD'),
        'legal_name' => env('SITE_LEGAL_NAME', 'SMSFlow BD (operating company name - configure)'),
        'address' => env('SITE_ADDRESS', 'Company address, Dhaka, Bangladesh (configure)'),
        'support_email' => env('SITE_SUPPORT_EMAIL', 'support@example.com'),
        'sales_email' => env('SITE_SALES_EMAIL', 'sales@example.com'),
    ],
];
