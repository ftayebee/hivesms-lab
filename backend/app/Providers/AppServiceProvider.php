<?php

namespace App\Providers;

use App\Auth\Permissions;
use App\Http\RequestContext;
use App\Models\User;
use App\Services\Platform\SettingsService;
use App\Services\Sms\SmsProviderManager;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Per-process caches (settings TTL, provider overrides in tests).
        $this->app->singleton(SettingsService::class);
        $this->app->singleton(SmsProviderManager::class);
    }

    public function boot(): void
    {
        // Outside production, fail loudly on mass-assigning privileged columns, lazy loading
        // (N+1 queries) and reading attributes that were not selected. Production stays lenient.
        Model::shouldBeStrict(! $this->app->isProduction());

        // Resources are wrapped by the API envelope (ApiResponse), not by Laravel's "data" key.
        JsonResource::withoutWrapping();

        $proxies = config('smsflow.trusted_proxies');
        if ($proxies) {
            TrustProxies::at($proxies === '*' ? '*' : array_map('trim', explode(',', (string) $proxies)));
        }

        $this->defineGates();
    }

    /**
     * Gates mirror the middleware checks so policies and ad-hoc checks (Gate::allows) use the same
     * rules: "org:<permission>" (active organization role) and "platform:<permission>" (staff role).
     */
    private function defineGates(): void
    {
        foreach (array_keys(Permissions::ORG) as $permission) {
            Gate::define("org:{$permission}", fn (?User $user) => (bool) RequestContext::maybeTenant(request())?->can($permission));
        }
        foreach (array_keys(Permissions::PLATFORM) as $permission) {
            Gate::define("platform:{$permission}", fn (User $user) => Permissions::platformCan($user->platformRole->value, $permission));
        }
    }
}
