<?php

namespace App\Jobs;

use App\Services\MetaTft\MetaTftSync;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Background sync job dispatched by ScoutController when the latest
 * meta_syncs row is older than 24h. Stale-while-revalidate: scout
 * requests return current data immediately, this job refreshes it
 * out-of-band for the next request.
 */
class RefreshMetaTftJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(
        public readonly int $setNumber,
    ) {}

    public function handle(MetaTftSync $sync): void
    {
        $sync->run($this->setNumber);
    }
}
