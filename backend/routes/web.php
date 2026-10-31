<?php

use Illuminate\Support\Facades\Route;

// API-only application: the UI is the Next.js app. The root answers with a pointer for humans.
Route::get('/', fn () => response()->json(['name' => config('app.name'), 'api' => url('/api/v1')]));
