<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $setNumber = (int) config('services.tft.set', 17);
        // `meta:refresh-active:N` is set by RevalidateMetaTft middleware
        // when it dispatches the refresh job, cleared by the job itself.
        // Initial page load reads it so the indicator can show up
        // instantly without a /status poll.
        $metaSyncRefreshing = Cache::has(RevalidateMetaTft::activeKey($setNumber));

        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'auth' => [
                'user' => $request->user(),
            ],
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
            'scoutLabEnabled' => env('SCOUT_LAB_ENABLED') === '1',
            'metaSyncRefreshing' => $metaSyncRefreshing,
        ];
    }
}
