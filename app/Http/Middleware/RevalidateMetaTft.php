<?php

namespace App\Http\Middleware;

use App\Jobs\RefreshMetaTftJob;
use App\Models\MetaSync;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Stale-while-revalidate for MetaTFT data on every web request.
 *
 * Flow (runs in terminate() so it never delays the response):
 *   1. Throttle: at most one stale-check per 5 minutes per process
 *      (Cache::add() with short TTL gates the DB query too).
 *   2. If the latest successful MetaSync row is older than 24h, try
 *      to acquire a 30-minute lock and dispatch RefreshMetaTftJob.
 *   3. The lock prevents concurrent requests from spawning duplicate
 *      sync jobs; the "active" flag exposes refresh status to the UI
 *      for the in-page loading indicator.
 *
 * The job itself clears both cache keys in a `finally` block so a
 * failed run can't strand the app in "refreshing forever" state.
 */
class RevalidateMetaTft
{
    private const STALE_HOURS = 24;

    private const GATE_TTL_MINUTES = 5;

    private const LOCK_TTL_MINUTES = 30;

    public function handle(Request $request, Closure $next): Response
    {
        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        // Cheap request-time gate — avoid the MetaSync query on every
        // request, once per 5 minutes is plenty for a "refresh if >24h"
        // check. `Cache::add` is atomic so only one concurrent request
        // gets through the gate.
        if (! Cache::add('meta:stale-gate', true, now()->addMinutes(self::GATE_TTL_MINUTES))) {
            return;
        }

        try {
            $setNumber = (int) config('services.tft.set', 17);
            $setId = self::setIdFor($setNumber);
            if ($setId === null) {
                return; // Set not imported yet — nothing to revalidate.
            }

            $last = MetaSync::query()
                ->where('set_id', $setId)
                ->where('status', 'ok')
                ->orderByDesc('synced_at')
                ->first();

            $stale = $last === null
                || $last->synced_at->lt(now()->subHours(self::STALE_HOURS));
            if (! $stale) {
                return;
            }

            // `Cache::add` returns false if the lock already exists —
            // another request already dispatched a refresh job this cycle.
            $lockKey = self::lockKey($setNumber);
            if (! Cache::add($lockKey, true, now()->addMinutes(self::LOCK_TTL_MINUTES))) {
                return;
            }

            Cache::put(
                self::activeKey($setNumber),
                true,
                now()->addMinutes(self::LOCK_TTL_MINUTES),
            );

            RefreshMetaTftJob::dispatch($setNumber);
        } catch (Throwable $e) {
            // Never let revalidation failures surface to the user —
            // this runs after the response is already sent.
            report($e);
        }
    }

    public static function lockKey(int $setNumber): string
    {
        return "meta:refresh-lock:{$setNumber}";
    }

    public static function activeKey(int $setNumber): string
    {
        return "meta:refresh-active:{$setNumber}";
    }

    private static function setIdFor(int $setNumber): ?int
    {
        return Cache::remember(
            "meta:set-id:{$setNumber}",
            now()->addHour(),
            fn () => \App\Models\Set::query()
                ->where('number', $setNumber)
                ->value('id'),
        );
    }
}
