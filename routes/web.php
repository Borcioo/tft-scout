<?php

use App\Http\Controllers\ChampionsController;
use App\Http\Controllers\ItemsController;
use App\Http\Controllers\PlansController;
use App\Http\Controllers\ScoutController;
use App\Http\Controllers\TraitsController;
use Illuminate\Support\Facades\Route;
use Laravel\Fortify\Features;

/*
|--------------------------------------------------------------------------
| Public pages
|--------------------------------------------------------------------------
| TFT Scout is a free tool — champion/trait/item/augment browsers and the
| Scout algorithm are accessible to anyone. Saved plans and admin dashboard
| live behind auth middleware.
*/

Route::inertia('/', 'welcome', [
    'canRegister' => Features::enabled(Features::registration()),
])->name('home');

// Scout workflow (public — algorithm runs client-side in a Web Worker)
Route::get('/scout', [ScoutController::class, 'index'])->name('scout.index');
Route::get('/api/scout/context', [ScoutController::class, 'context'])->name('scout.context');
Route::post('/api/scout/lab/ingest', [ScoutController::class, 'labIngest'])->name('scout.lab.ingest');

// Browse data (public read-only)
Route::get('/champions', [ChampionsController::class, 'index'])
    ->name('champions.index');
Route::get('/champions/{apiName}', [ChampionsController::class, 'show'])
    ->where('apiName', '[A-Za-z0-9_]+')
    ->name('champions.show');
Route::get('/traits', [TraitsController::class, 'index'])
    ->name('traits.index');
Route::get('/items', [ItemsController::class, 'index'])
    ->name('items.index');
Route::inertia('/augments', 'Augments/Index')->name('augments.index');

/*
|--------------------------------------------------------------------------
| Authenticated pages
|--------------------------------------------------------------------------
*/

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/plans', [PlansController::class, 'index'])->name('plans.index');
    Route::post('/api/plans', [PlansController::class, 'store'])->name('plans.store');
    Route::delete('/api/plans/{plan}', [PlansController::class, 'destroy'])->name('plans.destroy');

    // Admin / future premium features
    Route::inertia('/dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
