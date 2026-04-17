<?php

namespace App\Jobs;

use App\Http\Middleware\RevalidateMetaTft;
use App\Services\MetaTft\MetaTftSync;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;

/**
 * Background sync job dispatched by RevalidateMetaTft middleware when
 * the latest meta_syncs row is older than 24h. Stale-while-revalidate:
 * web requests return current data immediately, this job refreshes it
 * out-of-band for the next request.
 *
 * Three independent layers protect against duplicate concurrent runs
 * when many users hit the site at once:
 *   1. Middleware atomic Cache::add gate (5min) + refresh lock (30min)
 *   2. ShouldBeUnique — queue driver refuses to enqueue duplicates
 *      keyed by setNumber for 30min
 *   3. Service-layer Cache::lock inside MetaTftSync::run (protects
 *      CLI/queue overlap, e.g. `artisan metatft:sync` while job runs)
 *
 * Clears the middleware's refresh lock + active flag in `failed()` and
 * at the end of `handle()` so a crash can't strand the app in
 * "refreshing forever" state.
 */
class RefreshMetaTftJob implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    /** Dedup window for ShouldBeUnique. Matches the 30-min refresh lock. */
    public int $uniqueFor = 1800;

    public function __construct(
        public readonly int $setNumber,
    ) {}

    /**
     * Per-set uniqueness key. Two dispatches for the same setNumber
     * within $uniqueFor seconds → the second one is silently dropped
     * by the queue driver before it even hits the worker.
     */
    public function uniqueId(): string
    {
        return "meta-tft-sync:{$this->setNumber}";
    }

    public function handle(MetaTftSync $sync): void
    {
        try {
            $sync->run($this->setNumber, concurrency: 10);
        } finally {
            $this->clearLocks();
        }
    }

    public function failed(): void
    {
        $this->clearLocks();
    }

    private function clearLocks(): void
    {
        Cache::forget(RevalidateMetaTft::lockKey($this->setNumber));
        Cache::forget(RevalidateMetaTft::activeKey($this->setNumber));
    }
}
