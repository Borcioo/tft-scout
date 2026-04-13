<?php

namespace App\Console\Commands;

use App\Services\MetaTft\MetaTftSync as MetaTftSyncService;
use Illuminate\Console\Command;

class MetaTftSync extends Command
{
    protected $signature = 'metatft:sync {--set=17 : Set number to sync}';

    protected $description = 'Fetch MetaTFT aggregates and populate scout rating tables';

    public function handle(MetaTftSyncService $sync): int
    {
        $setNumber = (int) $this->option('set');

        $this->info("Syncing MetaTFT data for set {$setNumber}...");
        $start = microtime(true);

        $record = $sync->run($setNumber);

        $elapsed = round(microtime(true) - $start, 2);

        if ($record->status === 'ok') {
            $this->info("✓ Sync complete in {$elapsed}s");
        } else {
            $this->error("✗ Sync {$record->status} in {$elapsed}s — {$record->notes}");
        }

        $this->table(
            ['Category', 'Count'],
            [
                ['units', $record->units_count],
                ['traits', $record->traits_count],
                ['affinity', $record->affinity_count],
                ['companions', $record->companions_count],
                ['meta_comps', $record->meta_comps_count],
            ],
        );

        return $record->status === 'ok' ? Command::SUCCESS : Command::FAILURE;
    }
}
