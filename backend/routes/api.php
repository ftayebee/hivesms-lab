<?php

use App\Http\Controllers\Api\V1\HealthController;
use Illuminate\Support\Facades\Route;

/*
 * Versioned REST API: /api/v1/...
 * Endpoints are added module by module (see ../docs/09-laravel-migration-plan.md).
 */
Route::prefix('v1')->group(function (): void {
    Route::get('health', HealthController::class)->name('v1.health');
});
