<?php

use App\Http\Controllers\Api\V1\Account\ProfileController;
use App\Http\Controllers\Api\V1\Account\TeamController;
use App\Http\Controllers\Api\V1\Admin\AdminCustomerController;
use App\Http\Controllers\Api\V1\Admin\AdminCustomerPricingController;
use App\Http\Controllers\Api\V1\Admin\AdminExportController;
use App\Http\Controllers\Api\V1\Admin\AdminFinanceController;
use App\Http\Controllers\Api\V1\Admin\AdminPlatformController;
use App\Http\Controllers\Api\V1\Admin\AdminReviewController;
use App\Http\Controllers\Api\V1\Admin\AdminSettingsController;
use App\Http\Controllers\Api\V1\Admin\AdminStaffController;
use App\Http\Controllers\Api\V1\Admin\AdminSupportController;
use App\Http\Controllers\Api\V1\Admin\AdminUsageController;
use App\Http\Controllers\Api\V1\ApiKeys\ApiKeyController;
use App\Http\Controllers\Api\V1\Auth\AuthController;
use App\Http\Controllers\Api\V1\Auth\GoogleAuthController;
use App\Http\Controllers\Api\V1\Campaigns\CampaignController;
use App\Http\Controllers\Api\V1\Contacts\ContactController;
use App\Http\Controllers\Api\V1\Contacts\ContactExportController;
use App\Http\Controllers\Api\V1\Contacts\ContactGroupController;
use App\Http\Controllers\Api\V1\Contacts\ContactImportController;
use App\Http\Controllers\Api\V1\Contacts\SuppressionController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\Internal\WorkerController;
use App\Http\Controllers\Api\V1\Payments\PaymentController;
use App\Http\Controllers\Api\V1\PublicController;
use App\Http\Controllers\Api\V1\Reports\DashboardController;
use App\Http\Controllers\Api\V1\Reports\ReportController;
use App\Http\Controllers\Api\V1\SenderIds\SenderIdController;
use App\Http\Controllers\Api\V1\Sms\PublicApiController;
use App\Http\Controllers\Api\V1\Sms\SmsController;
use App\Http\Controllers\Api\V1\Support\SupportController;
use App\Http\Controllers\Api\V1\Templates\TemplateController;
use App\Http\Controllers\Api\V1\Wallet\WalletController;
use App\Http\Controllers\Api\V1\Webhooks\PaymentWebhookController;
use App\Http\Controllers\Api\V1\Webhooks\SmsWebhookController;
use Illuminate\Support\Facades\Route;

// --------------------------------------------------------------------------
// SMSFlow REST API — /api/v1
// --------------------------------------------------------------------------
// Four audiences, four authentication schemes (never mixed on one route):
//   public         none (rate-limited)                         /health, /public/*, /auth/login…
//   customer API   API key  (Authorization: Bearer sfk_live_…) /sms/*, /messages, /balance, /sender-ids
//   dashboard      session  (Authorization: Bearer <session>)  /auth/me…, /profile…, /app/*
//   staff          session + platform role                      /admin/*
// Provider callbacks (/webhooks/*, /payments/*/return) authenticate by signature / gateway
// re-validation. Every response uses the {success, data|error, meta.requestId} envelope except the
// provider callbacks (providers expect plain JSON) and CSV/file downloads.

Route::prefix('v1')->name('v1.')->group(function (): void {
    $uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
    Route::pattern('id', $uuid);
    Route::pattern('memberId', $uuid);
    Route::pattern('importId', $uuid);
    Route::pattern('index', '[0-9]{1,2}');

    // ─── Public ───
    Route::get('health', HealthController::class)->name('health');
    Route::get('internal/ready', [HealthController::class, 'ready'])->name('internal.ready');
    Route::match(['get', 'post'], 'internal/worker/tick', WorkerController::class)->name('internal.worker');

    Route::prefix('public')->name('public.')->group(function (): void {
        Route::get('pricing', [PublicController::class, 'pricing'])->name('pricing');
        Route::get('site-content', [PublicController::class, 'siteContent'])->name('site');
        Route::post('contact', [PublicController::class, 'contact'])->name('contact');
        Route::post('abuse-reports', [PublicController::class, 'abuse'])->name('abuse');
    });

    // ─── Authentication ───
    Route::prefix('auth')->name('auth.')->group(function (): void {
        Route::post('register', [AuthController::class, 'register'])->name('register');
        Route::post('login', [AuthController::class, 'login'])->name('login');
        Route::get('providers', [GoogleAuthController::class, 'providers'])->name('providers');
        Route::post('google', [GoogleAuthController::class, 'signIn'])->name('google');
        Route::middleware('ratelimit:password_reset_per_ip')->group(function (): void {
            Route::post('email/verify', [AuthController::class, 'verifyEmail'])->name('verify-email');
            Route::post('verify-email', [AuthController::class, 'verifyEmail'])->name('verify-email.alias');
            Route::post('password/reset', [AuthController::class, 'resetPassword'])->name('reset-password');
            Route::post('reset-password', [AuthController::class, 'resetPassword'])->name('reset-password.alias');
        });
        Route::post('password/forgot', [AuthController::class, 'forgotPassword'])->name('forgot-password');
        Route::post('forgot-password', [AuthController::class, 'forgotPassword'])->name('forgot-password.alias');
        Route::get('invitations/{token}', [AuthController::class, 'invitation'])->where('token', '[A-Za-z0-9_-]{20,200}')->middleware('ratelimit:public_form_per_ip')->name('invitation');
        Route::post('invitations/signup', [AuthController::class, 'invitationSignup'])->middleware('ratelimit:register_per_ip')->name('invitation.signup');

        Route::middleware('auth.session')->group(function (): void {
            Route::get('me', [AuthController::class, 'me'])->name('me');
            Route::post('logout', [AuthController::class, 'logout'])->name('logout');
            Route::post('email/resend', [AuthController::class, 'resendVerification'])->middleware('ratelimit:otp_per_user')->name('resend-verification');
            Route::post('resend-verification', [AuthController::class, 'resendVerification'])->middleware('ratelimit:otp_per_user')->name('resend-verification.alias');
            Route::post('phone/otp', [AuthController::class, 'sendOtp'])->name('phone.otp');
            Route::post('phone/verify', [AuthController::class, 'verifyOtp'])->middleware('ratelimit:otp_per_user')->name('phone.verify');
            Route::post('switch-organization', [AuthController::class, 'switchOrganization'])->name('switch-organization');
            Route::post('organizations', [AuthController::class, 'createOrganization'])->name('organizations.create');
            Route::post('invitations/accept', [AuthController::class, 'acceptInvitation'])->name('invitation.accept');
        });
    });

    // ─── Signed-in user (no organization required) ───
    Route::middleware(['auth.session', 'ratelimit:dashboard_per_user'])->group(function (): void {
        Route::get('profile', [ProfileController::class, 'show'])->name('profile.show');
        Route::put('profile', [ProfileController::class, 'update'])->name('profile.update');
        Route::put('profile/password', [ProfileController::class, 'password'])->name('profile.password');
        Route::put('profile/locale', [ProfileController::class, 'locale'])->name('profile.locale');
        Route::get('profile/sessions', [ProfileController::class, 'sessions'])->name('profile.sessions');
        Route::delete('profile/sessions/{id}', [ProfileController::class, 'revokeSession'])->name('profile.sessions.revoke');
        Route::get('profile/notification-preferences', [ProfileController::class, 'notificationPreferences'])->name('profile.prefs');
        Route::put('profile/notification-preferences', [ProfileController::class, 'saveNotificationPreferences'])->name('profile.prefs.update');
    });

    // ─── Customer SMS API (API keys) — existing public contract ───
    Route::middleware(['api.key:sms:send', 'ratelimit:api_send_per_key', 'idempotent'])->group(function (): void {
        Route::post('sms/send', [SmsController::class, 'send'])->name('sms.send');
        Route::post('sms/bulk', [SmsController::class, 'bulk'])->name('sms.bulk');
    });
    Route::post('sms/estimate', [SmsController::class, 'estimate'])->middleware(['api.key:sms:send', 'ratelimit:api_per_key'])->name('sms.estimate');
    Route::get('messages', [PublicApiController::class, 'messages'])->middleware(['api.key:messages:read', 'ratelimit:api_per_key'])->name('messages.index');
    Route::get('messages/{id}', [PublicApiController::class, 'message'])->where('id', '[^/]+')->middleware(['api.key:messages:read', 'ratelimit:api_per_key'])->name('messages.show');
    Route::get('balance', [PublicApiController::class, 'balance'])->middleware(['api.key:balance:read', 'ratelimit:api_per_key'])->name('balance');
    Route::get('sender-ids', [PublicApiController::class, 'senderIds'])->middleware(['api.key:sender_ids:read', 'ratelimit:api_per_key'])->name('sender-ids');

    // ─── Provider callbacks ───
    Route::middleware('ratelimit:webhook_per_ip')->group(function (): void {
        Route::post('webhooks/sms/{provider}', [SmsWebhookController::class, 'delivery'])->where('provider', '[a-z0-9_-]{1,30}')->name('webhooks.sms');
        Route::post('webhooks/sms/{provider}/inbound', [SmsWebhookController::class, 'inbound'])->where('provider', '[a-z0-9_-]{1,30}')->name('webhooks.sms.inbound');
        Route::post('webhooks/payments/{provider}', [PaymentWebhookController::class, 'ipn'])->where('provider', '[a-z0-9_-]{1,30}')->name('webhooks.payments');
        Route::match(['get', 'post'], 'payments/{provider}/return', [PaymentWebhookController::class, 'return'])->where('provider', '[a-z0-9_-]{1,30}')->name('payments.return');
    });

    // ─── Dashboard (session + active organization + permission) ───
    Route::prefix('app')->name('app.')->middleware(['auth.session', 'ratelimit:dashboard_per_user'])->group(function (): void {
        Route::get('dashboard', DashboardController::class)->middleware('tenant:dashboard:read')->name('dashboard');

        // Organization, notifications
        Route::get('organization', [ProfileController::class, 'organization'])->middleware('tenant')->name('organization.show');
        Route::put('organization', [ProfileController::class, 'updateOrganization'])->middleware('tenant:settings:manage')->name('organization.update');
        Route::post('organization/leave', [ProfileController::class, 'leaveOrganization'])->middleware('tenant')->name('organization.leave');
        Route::get('notifications', [ProfileController::class, 'notifications'])->middleware('tenant')->name('notifications');
        Route::post('notifications/read', [ProfileController::class, 'markNotificationsRead'])->middleware('tenant')->name('notifications.read');

        // Contacts
        Route::middleware('tenant:contacts:read')->group(function (): void {
            Route::get('contacts', [ContactController::class, 'index'])->name('contacts.index');
            Route::get('contacts/tags', [ContactController::class, 'tags'])->name('contacts.tags');
            Route::get('contacts/imports/{importId}', [ContactImportController::class, 'show'])->name('contacts.imports.show');
            Route::get('contacts/{id}', [ContactController::class, 'show'])->name('contacts.show');
            Route::get('contact-groups', [ContactGroupController::class, 'index'])->name('groups.index');
            Route::get('contact-groups/{id}', [ContactGroupController::class, 'show'])->name('groups.show');
            Route::get('contact-groups/{id}/contacts', [ContactGroupController::class, 'contacts'])->name('groups.contacts');
            Route::get('suppression', [SuppressionController::class, 'index'])->name('suppression.index');
        });
        Route::get('contacts/export', ContactExportController::class)->middleware('tenant:contacts:export')->name('contacts.export');
        Route::middleware('tenant:contacts:write')->group(function (): void {
            Route::post('contacts', [ContactController::class, 'store'])->name('contacts.store');
            Route::post('contacts/bulk', [ContactController::class, 'bulk'])->name('contacts.bulk');
            Route::post('contacts/import', [ContactImportController::class, 'store'])->name('contacts.import');
            Route::put('contacts/{id}', [ContactController::class, 'update'])->name('contacts.update');
            Route::delete('contacts/{id}', [ContactController::class, 'destroy'])->name('contacts.destroy');
            Route::post('contact-groups', [ContactGroupController::class, 'store'])->name('groups.store');
            Route::put('contact-groups/{id}', [ContactGroupController::class, 'update'])->name('groups.update');
            Route::delete('contact-groups/{id}', [ContactGroupController::class, 'destroy'])->name('groups.destroy');
            Route::post('contact-groups/{id}/contacts', [ContactGroupController::class, 'attach'])->name('groups.attach');
            Route::delete('contact-groups/{id}/contacts', [ContactGroupController::class, 'detach'])->name('groups.detach');
            Route::post('suppression', [SuppressionController::class, 'store'])->name('suppression.store');
            Route::delete('suppression/{id}', [SuppressionController::class, 'destroy'])->name('suppression.destroy');
        });

        // Templates
        Route::get('templates', [TemplateController::class, 'index'])->middleware('tenant:templates:read')->name('templates.index');
        Route::get('templates/{id}', [TemplateController::class, 'show'])->middleware('tenant:templates:read')->name('templates.show');
        Route::middleware('tenant:templates:write')->group(function (): void {
            Route::post('templates', [TemplateController::class, 'store'])->name('templates.store');
            Route::put('templates/{id}', [TemplateController::class, 'update'])->name('templates.update');
            Route::delete('templates/{id}', [TemplateController::class, 'destroy'])->name('templates.destroy');
        });

        // Sender IDs
        Route::middleware('tenant:sender_ids:read')->group(function (): void {
            Route::get('sender-ids', [SenderIdController::class, 'index'])->name('sender-ids.index');
            Route::get('sender-ids/approved', [SenderIdController::class, 'approved'])->name('sender-ids.approved');
            Route::get('sender-ids/{id}', [SenderIdController::class, 'show'])->name('sender-ids.show');
            Route::get('sender-ids/{id}/documents/{index}', [SenderIdController::class, 'document'])->name('sender-ids.document');
        });
        Route::middleware('tenant:sender_ids:manage')->group(function (): void {
            Route::post('sender-ids', [SenderIdController::class, 'store'])->name('sender-ids.store');
            Route::put('sender-ids/{id}', [SenderIdController::class, 'update'])->name('sender-ids.update');
            Route::delete('sender-ids/{id}', [SenderIdController::class, 'destroy'])->name('sender-ids.destroy');
        });

        // Campaigns (bulk SMS)
        Route::middleware('tenant:campaigns:read')->group(function (): void {
            Route::get('campaigns', [CampaignController::class, 'index'])->name('campaigns.index');
            Route::get('campaigns/{id}', [CampaignController::class, 'show'])->name('campaigns.show');
            Route::get('campaigns/{id}/stats', [CampaignController::class, 'stats'])->name('campaigns.stats');
            Route::get('campaigns/{id}/messages', [CampaignController::class, 'messages'])->name('campaigns.messages');
        });
        Route::get('campaigns/{id}/export', [CampaignController::class, 'export'])->middleware('tenant:reports:export')->name('campaigns.export');
        Route::middleware('tenant:campaigns:write')->group(function (): void {
            Route::post('campaigns', [CampaignController::class, 'store'])->name('campaigns.store');
            Route::put('campaigns/{id}', [CampaignController::class, 'update'])->name('campaigns.update');
            Route::delete('campaigns/{id}', [CampaignController::class, 'destroy'])->name('campaigns.destroy');
            Route::post('campaigns/{id}/pause', [CampaignController::class, 'pause'])->name('campaigns.pause');
            Route::post('campaigns/{id}/resume', [CampaignController::class, 'resume'])->name('campaigns.resume');
            Route::post('campaigns/{id}/cancel', [CampaignController::class, 'cancel'])->name('campaigns.cancel');
            Route::post('campaigns/{id}/duplicate', [CampaignController::class, 'duplicate'])->name('campaigns.duplicate');
            Route::post('sms/segments', [CampaignController::class, 'segments'])->name('sms.segments');
            Route::get('sms/composer', [CampaignController::class, 'composer'])->name('sms.composer');
        });
        Route::middleware(['tenant:campaigns:write,sms:send', 'verified.email', 'ratelimit:dashboard_send_per_user', 'idempotent'])->group(function (): void {
            Route::post('campaigns/estimate', [CampaignController::class, 'estimate'])->name('campaigns.estimate');
            Route::post('campaigns/submit', [CampaignController::class, 'submit'])->name('campaigns.submit');
            Route::post('campaigns/{id}/send', [CampaignController::class, 'send'])->name('campaigns.send');
            Route::post('campaigns/{id}/schedule', [CampaignController::class, 'schedule'])->name('campaigns.schedule');
            Route::post('campaigns/{id}/retry', [CampaignController::class, 'retry'])->name('campaigns.retry');
        });

        // Reports & message history
        Route::middleware('tenant:reports:read')->group(function (): void {
            Route::get('reports/delivery', [ReportController::class, 'delivery'])->name('reports.delivery');
            Route::get('reports/filters', [ReportController::class, 'filterOptions'])->name('reports.filters');
            Route::get('reports/campaigns', [ReportController::class, 'campaigns'])->name('reports.campaigns');
            Route::get('reports/messages', [ReportController::class, 'messages'])->name('reports.messages');
            Route::get('messages', [ReportController::class, 'messages'])->name('messages.index');
            Route::get('messages/{id}', [ReportController::class, 'message'])->name('messages.show');
        });
        Route::get('reports/usage', [ReportController::class, 'usage'])->middleware('tenant:billing:read')->name('reports.usage');
        Route::get('reports/export', [ReportController::class, 'export'])->middleware('tenant:reports:export')->name('reports.export');

        // Wallet & payments
        Route::middleware('tenant:billing:read')->group(function (): void {
            Route::get('wallet', [WalletController::class, 'show'])->name('wallet.show');
            Route::get('wallet/transactions', [WalletController::class, 'transactions'])->name('wallet.transactions');
            Route::get('wallet/transactions/export', [WalletController::class, 'exportTransactions'])->name('wallet.transactions.export');
            Route::get('transactions/export', [WalletController::class, 'exportTransactions'])->name('transactions.export'); // path used by the current UI
            Route::get('wallet/transactions/{id}', [WalletController::class, 'transaction'])->name('wallet.transaction');
            Route::get('wallet/invoices', [WalletController::class, 'invoices'])->name('wallet.invoices');
            Route::get('wallet/invoices/{id}', [WalletController::class, 'invoice'])->name('wallet.invoice');
            Route::get('payments', [PaymentController::class, 'index'])->name('payments.index');
            Route::get('payments/methods', [PaymentController::class, 'methods'])->name('payments.methods');
            Route::post('payments/preview', [PaymentController::class, 'preview'])->name('payments.preview');
            Route::get('payments/{id}', [PaymentController::class, 'show'])->name('payments.show');
        });
        Route::middleware('tenant:billing:manage')->group(function (): void {
            Route::put('wallet/threshold', [WalletController::class, 'threshold'])->name('wallet.threshold');
            Route::post('payments', [PaymentController::class, 'store'])->middleware('idempotent')->name('payments.store');
            Route::post('payments/{id}/reference', [PaymentController::class, 'submitReference'])->name('payments.reference');
            Route::post('payments/{id}/cancel', [PaymentController::class, 'cancel'])->name('payments.cancel');
            Route::post('payments/{id}/mock-complete', [PaymentController::class, 'mockComplete'])->name('payments.mock');
        });

        // Developers
        Route::middleware('tenant:api_keys:read')->group(function (): void {
            Route::get('api-keys', [ApiKeyController::class, 'index'])->name('api-keys.index');
            Route::get('api-logs', [ApiKeyController::class, 'logs'])->name('api-logs');
            Route::get('webhooks', [ApiKeyController::class, 'webhooks'])->name('webhooks.index');
        });
        Route::middleware('tenant:api_keys:manage')->group(function (): void {
            Route::post('api-keys', [ApiKeyController::class, 'store'])->name('api-keys.store');
            Route::delete('api-keys/{id}', [ApiKeyController::class, 'destroy'])->name('api-keys.destroy');
            Route::post('webhooks', [ApiKeyController::class, 'storeWebhook'])->name('webhooks.store');
            Route::put('webhooks/{id}', [ApiKeyController::class, 'updateWebhook'])->name('webhooks.update');
            Route::delete('webhooks/{id}', [ApiKeyController::class, 'destroyWebhook'])->name('webhooks.destroy');
            Route::post('webhooks/{id}/test', [ApiKeyController::class, 'testWebhook'])->name('webhooks.test');
        });

        // Team
        Route::get('team', [TeamController::class, 'index'])->middleware('tenant:team:read')->name('team.index');
        Route::middleware('tenant:team:manage')->group(function (): void {
            Route::post('team/invitations', [TeamController::class, 'invite'])->name('team.invite');
            Route::delete('team/invitations/{id}', [TeamController::class, 'revokeInvitation'])->name('team.invite.revoke');
            Route::put('team/members/{memberId}/role', [TeamController::class, 'changeRole'])->name('team.role');
            Route::post('team/members/{memberId}/status', [TeamController::class, 'setStatus'])->name('team.status');
            Route::put('team/roles/{role}/permissions', [TeamController::class, 'updateRolePermissions'])->where('role', '[A-Z]{4,9}')->name('team.permissions');
        });

        // Support
        Route::middleware('tenant:support:read')->group(function (): void {
            Route::get('support/tickets', [SupportController::class, 'index'])->name('support.index');
            Route::get('support/tickets/{id}', [SupportController::class, 'show'])->name('support.show');
        });
        Route::middleware('tenant:support:write')->group(function (): void {
            Route::post('support/tickets', [SupportController::class, 'store'])->name('support.store');
            Route::post('support/tickets/{id}/messages', [SupportController::class, 'reply'])->name('support.reply');
            Route::post('support/tickets/{id}/close', [SupportController::class, 'close'])->name('support.close');
        });
    });

    // ─── Platform staff ───
    Route::prefix('admin')->name('admin.')->middleware(['auth.session', 'ratelimit:admin_write_per_user'])->group(function (): void {
        Route::get('overview', [AdminPlatformController::class, 'overview'])->middleware('platform:admin:access')->name('overview');
        Route::get('stats', [AdminPlatformController::class, 'stats'])->middleware('platform:admin:access')->name('stats');
        Route::get('badges', [AdminPlatformController::class, 'badges'])->middleware('platform:admin:access')->name('badges');
        Route::get('wallets', [AdminCustomerController::class, 'wallets'])->middleware('platform:admin:billing:read')->name('wallets');

        Route::middleware('platform:admin:customers:read')->group(function (): void {
            Route::get('customers', [AdminCustomerController::class, 'index'])->name('customers.index');
            Route::get('customers/{id}', [AdminCustomerController::class, 'show'])->name('customers.show');
            Route::get('customers/{id}/usage', [AdminUsageController::class, 'show'])->name('customers.usage');
            Route::get('usage', [AdminUsageController::class, 'index'])->name('usage');
            Route::get('customers/{id}/pricing', [AdminCustomerPricingController::class, 'show'])->name('customers.pricing');
            Route::get('leads', [AdminPlatformController::class, 'leads'])->name('leads');
            Route::put('leads/{id}', [AdminPlatformController::class, 'updateLead'])->name('leads.update');
        });
        Route::middleware('platform:admin:customers:manage')->group(function (): void {
            Route::put('customers/{id}/controls', [AdminCustomerController::class, 'updateControls'])->name('customers.controls');
            Route::post('customers/{id}/status', [AdminCustomerController::class, 'status'])->name('customers.status');
        });
        Route::middleware('platform:admin:pricing:customer')->group(function (): void {
            Route::put('customers/{id}/pricing', [AdminCustomerPricingController::class, 'update'])->name('customers.pricing.update');
            Route::post('customers/{id}/pricing/reset', [AdminCustomerPricingController::class, 'reset'])->name('customers.pricing.reset');
        });
        // Money-moving: SUPER_ADMIN only, password re-confirmation and idempotency key (AdminFinanceController).
        Route::post('customers/{id}/wallet-adjustments', [AdminFinanceController::class, 'adjustWallet'])->middleware('platform:admin:wallet:adjust')->name('customers.wallet');
        Route::post('users/{id}/password-reset', [AdminStaffController::class, 'sendPasswordReset'])->middleware('platform:admin:customers:manage')->name('users.password-reset');

        Route::get('campaigns', [AdminReviewController::class, 'campaigns'])->middleware('platform:admin:campaigns:review')->name('campaigns.index');
        Route::post('campaigns/{id}/review', [AdminReviewController::class, 'reviewCampaign'])->middleware('platform:admin:campaigns:review')->name('campaigns.review');

        Route::middleware('platform:admin:sender_ids:review')->group(function (): void {
            Route::get('sender-ids', [AdminReviewController::class, 'senderIds'])->name('sender-ids.index');
            Route::post('sender-ids/{id}/review', [AdminReviewController::class, 'reviewSenderId'])->name('sender-ids.review');
            Route::get('sender-ids/{id}/documents/{index}', [AdminReviewController::class, 'senderIdDocument'])->name('sender-ids.document');
        });

        Route::get('payments', [AdminReviewController::class, 'payments'])->middleware('platform:admin:billing:read')->name('payments.index');
        Route::post('payments/{id}/review', [AdminReviewController::class, 'reviewPayment'])->middleware('platform:admin:billing:manage')->name('payments.review');
        Route::post('payments/{id}/refund', [AdminFinanceController::class, 'refund'])->middleware('platform:admin:payments:refund')->name('payments.refund');

        Route::middleware('platform:admin:support')->group(function (): void {
            Route::get('support/tickets', [AdminSupportController::class, 'index'])->name('support.index');
            Route::get('support/tickets/{id}', [AdminSupportController::class, 'show'])->name('support.show');
            Route::post('support/tickets/{id}/messages', [AdminSupportController::class, 'reply'])->name('support.reply');
            Route::put('support/tickets/{id}/status', [AdminSupportController::class, 'status'])->name('support.status');
        });

        Route::get('users', [AdminPlatformController::class, 'users'])->middleware('platform:admin:users:manage')->name('users.index');
        Route::middleware('platform:admin:users:manage')->group(function (): void {
            Route::put('users/{id}/access', [AdminStaffController::class, 'updateAccess'])->name('users.access');
            Route::post('staff', [AdminStaffController::class, 'invite'])->name('staff.invite');
            Route::get('staff/permissions', [AdminStaffController::class, 'permissions'])->name('staff.permissions');
            Route::get('staff/history', [AdminStaffController::class, 'history'])->name('staff.history');
        });

        // Super Admin dashboard, finance, health and exports (docs/18).
        Route::get('dashboard', [AdminFinanceController::class, 'dashboard'])->middleware('platform:admin:access')->name('dashboard');
        Route::middleware('platform:admin:finance:read')->group(function (): void {
            Route::get('finance/summary', [AdminFinanceController::class, 'summary'])->name('finance.summary');
            Route::get('finance/provider-balance', [AdminFinanceController::class, 'providerBalance'])->name('finance.provider-balance');
            Route::get('finance/transactions', [AdminFinanceController::class, 'transactions'])->name('finance.transactions');
            Route::get('finance/margins', [AdminFinanceController::class, 'margins'])->name('finance.margins');
            Route::get('finance/provider-costs', [AdminFinanceController::class, 'providerCosts'])->name('finance.costs');
        });
        Route::put('finance/provider-costs', [AdminFinanceController::class, 'saveProviderCosts'])->middleware('platform:admin:costs:manage')->name('finance.costs.update');
        Route::get('system/health', [AdminFinanceController::class, 'health'])->middleware('platform:admin:health:read')->name('system.health');
        Route::get('exports/{kind}', [AdminExportController::class, 'export'])->where('kind', '[a-z-]{3,30}')->middleware('platform:admin:reports:export')->name('exports');

        Route::middleware('platform:admin:abuse:manage')->group(function (): void {
            Route::get('abuse-reports', [AdminPlatformController::class, 'abuseReports'])->name('abuse.index');
            Route::put('abuse-reports/{id}', [AdminPlatformController::class, 'updateAbuse'])->name('abuse.update');
            Route::get('blocklist', [AdminSettingsController::class, 'blocklist'])->name('blocklist.index');
            Route::post('blocklist', [AdminSettingsController::class, 'addBlocklist'])->name('blocklist.store');
            Route::delete('blocklist/{id}', [AdminSettingsController::class, 'removeBlocklist'])->name('blocklist.destroy');
        });

        Route::get('messages', [AdminPlatformController::class, 'messages'])->middleware('platform:admin:messages:read')->name('messages');
        Route::get('audit-logs', [AdminPlatformController::class, 'auditLogs'])->middleware('platform:admin:audit:read')->name('audit');
        // Same permission as the admin "API logs" page of the Next.js app (support staff investigate customer integrations).
        Route::get('api-logs', [AdminPlatformController::class, 'apiLogs'])->middleware('platform:admin:messages:read')->name('api-logs');

        Route::middleware('platform:admin:pricing:manage')->group(function (): void {
            Route::get('pricing/plans', [AdminSettingsController::class, 'plans'])->name('plans.index');
            Route::post('pricing/plans', [AdminSettingsController::class, 'storePlan'])->name('plans.store');
            Route::put('pricing/plans/{id}', [AdminSettingsController::class, 'updatePlan'])->name('plans.update');
            Route::get('pricing/packages', [AdminSettingsController::class, 'packages'])->name('packages.index');
            Route::post('pricing/packages', [AdminSettingsController::class, 'storePackage'])->name('packages.store');
            Route::put('pricing/packages/{id}', [AdminSettingsController::class, 'updatePackage'])->name('packages.update');
            Route::get('settings/billing-policy', [AdminSettingsController::class, 'billingPolicy'])->name('settings.billing.show');
            Route::put('settings/billing-policy', [AdminSettingsController::class, 'updateSettings'])->defaults('section', 'billing-policy')->name('settings.billing');
        });
        Route::middleware('platform:admin:settings:manage')->group(function (): void {
            Route::get('settings', [AdminSettingsController::class, 'settings'])->name('settings.show');
            Route::put('settings/{section}', [AdminSettingsController::class, 'updateSettings'])->where('section', 'sms-policy|sms-provider|payments|site-content')->name('settings.update');
        });
    });
});
