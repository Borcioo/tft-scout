<?php

namespace App\Console\Commands;

use App\Services\Import\CDragonImporter;
use Illuminate\Console\Command;
use Throwable;

/**
 * Artisan command: php artisan tft:import
 *
 * Imports a TFT set from CommunityDragon into the local database.
 * Delegates all work to CDragonImporter service — this command is just
 * CLI plumbing (options parsing, progress reporting, error handling).
 */
class ImportCDragon extends Command
{
    protected $signature = 'tft:import
        {--set=17 : Set number to import (default: 17)}';

    protected $description = 'Import TFT data (champions, traits, items, augments) from CommunityDragon';

    public function handle(CDragonImporter $importer): int
    {
        $setNumber = (int) $this->option('set');

        $this->info("Importing TFT Set {$setNumber} from CommunityDragon...");
        $this->newLine();

        $startedAt = microtime(true);

        try {
            $counts = $importer->import($setNumber);
        } catch (Throwable $e) {
            $this->error('Import failed: '.$e->getMessage());
            $this->line($e->getTraceAsString());

            return self::FAILURE;
        }

        $elapsed = number_format(microtime(true) - $startedAt, 2);

        $this->info("✓ Import complete in {$elapsed}s");
        $this->newLine();

        $this->table(
            ['Entity', 'Count'],
            collect($counts)->map(fn ($count, $label) => [$label, $count])->values()->all()
        );

        return self::SUCCESS;
    }
}
