<?php

namespace App\Console\Commands;

use App\Services\Tft\AbilityDescriptionResolver;
use App\Services\Tft\CharacterBinInspector;
use App\Services\Tft\StatHashResolver;
use Illuminate\Console\Command;
use Throwable;

/**
 * Artisan command: php artisan tft:inspect-character TFT17_MissFortune
 *
 * Read-only diagnostic for CommunityDragon character BIN files. Fetches
 * `game/characters/{apiName}.cdtb.bin.json` (+ the `_traitclone` sibling if
 * it exists), resolves trait hash references, and prints a structured
 * report. Nothing is written to the database.
 *
 * Use this to verify a character's variant mechanic before writing import
 * code for it — e.g., to confirm Miss Fortune's 3 variant traits match what
 * we expect, or to investigate a new champion in a future set.
 */
class InspectCharacterBin extends Command
{
    protected $signature = 'tft:inspect-character
        {apiName : Champion API name, e.g. TFT17_MissFortune}
        {--channel=pbe : CDragon channel (pbe or latest)}
        {--star=2 : Star level to render ability descriptions at (0-6)}
        {--json : Output raw JSON instead of formatted tables}';

    protected $description = 'Inspect a TFT champion BIN file from CommunityDragon (read-only)';

    public function handle(
        CharacterBinInspector $inspector,
        StatHashResolver $statResolver,
        AbilityDescriptionResolver $abilityResolver,
    ): int {
        $apiName = $this->argument('apiName');
        $channel = $this->option('channel');
        $starLevel = (int) $this->option('star');

        $this->info("Fetching {$apiName} from CDragon (channel: {$channel})...");
        $this->newLine();

        try {
            $report = $inspector->inspect($apiName, $channel);
            $this->attachResolvedStats($report, $statResolver);
            $this->attachResolvedAbilities($report, $abilityResolver, $channel, $starLevel);
        } catch (Throwable $e) {
            $this->error('Inspection failed: '.$e->getMessage());

            return self::FAILURE;
        }

        if ($this->option('json')) {
            $this->line(json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

            return self::SUCCESS;
        }

        $this->printReport($report);

        return self::SUCCESS;
    }

    private function printReport(array $report): void
    {
        $this->line("<fg=cyan>Set:</> {$report['set_number']}");
        $this->line("<fg=cyan>Trait hash map:</> {$report['trait_map_size']} entries");
        $this->line('<fg=cyan>Variant choice:</> '.($report['has_variant_choice'] ? '<fg=green>YES</>' : 'no'));
        $this->newLine();

        $this->printCharacterSection('Main record', $report['main']);

        if ($report['trait_clone'] !== null) {
            $this->newLine();
            $this->printCharacterSection('TraitClone (variant template)', $report['trait_clone']);
            $this->newLine();
            $this->printVariantSummary($report['main'], $report['trait_clone']);
        }
    }

    private function printCharacterSection(string $label, array $record): void
    {
        $this->line("<fg=yellow>=== {$label} ===</>");
        $this->line("Character name: <fg=white>{$record['character_name']}</>");
        $this->line('Source: <fg=gray>'.$record['url'].'</>');

        $stats = $record['raw_hash_keys'];
        $this->line("Fields: {$stats['named_fields']} named, {$stats['hashed_fields']} hashed");

        if (! empty($record['spell_names'])) {
            $this->line('Spells: <fg=white>'.implode(', ', $record['spell_names']).'</>');
        }

        if (empty($record['linked_traits'])) {
            $this->line('Linked traits: <fg=gray>(none)</>');
        } else {
            $this->line('Linked traits:');
            $rows = array_map(fn (array $t) => [
                $t['hash'] ?? '—',
                $t['api_name'] !== null
                    ? "<fg=green>{$t['api_name']}</>"
                    : '<fg=red>UNRESOLVED</>',
            ], $record['linked_traits']);

            $this->table(['Hash', 'Trait api_name'], $rows);
        }

        if (! empty($record['resolved_stats'] ?? [])) {
            $this->line('Stats (value-matched via Rosetta Stone):');
            $rows = array_map(fn (array $s) => [
                $s['hash'],
                $s['stat'] !== null
                    ? "<fg=green>{$s['stat']}</>"
                    : '<fg=yellow>unresolved</>',
                number_format((float) $s['value'], 4),
            ], $record['resolved_stats']);

            $this->table(['Hash', 'Stat', 'Value'], $rows);
        }
    }

    /**
     * Run the resolved stats through StatHashResolver and attach the
     * result back onto the report dict so print/json both see them.
     */
    private function attachResolvedStats(array &$report, StatHashResolver $resolver): void
    {
        foreach (['main', 'trait_clone'] as $section) {
            if (! isset($report[$section]) || ! is_array($report[$section])) {
                continue;
            }
            $hashedStats = $report[$section]['hashed_stats'] ?? [];
            $report[$section]['resolved_stats'] = $resolver->resolve($hashedStats);
        }
    }

    /**
     * For each spell in main + trait_clone sections, resolve its loc keys
     * against the RST stringtable and render @variable@ placeholders.
     */
    private function attachResolvedAbilities(
        array &$report,
        AbilityDescriptionResolver $resolver,
        string $channel,
        int $starLevel,
    ): void {
        foreach (['main', 'trait_clone'] as $section) {
            if (! isset($report[$section]['spells']) || ! is_array($report[$section]['spells'])) {
                continue;
            }
            foreach ($report[$section]['spells'] as &$spell) {
                $spell['resolved_ability'] = $resolver->resolve(
                    $spell['loc_keys'] ?? ['key_name' => null, 'key_tooltip' => null],
                    $spell['data_values'] ?? [],
                    $starLevel,
                    $channel,
                    calculations: $spell['calculations'] ?? [],
                );
            }
            unset($spell);
        }
    }

    private function printVariantSummary(array $main, array $clone): void
    {
        $mainTraits = collect($main['linked_traits'])->pluck('api_name')->filter()->all();
        $variantTraits = collect($clone['linked_traits'])->pluck('api_name')->filter()->all();

        $this->line('<fg=magenta>=== Variant mechanic summary ===</>');
        $this->line('Base traits (main record): <fg=white>'.implode(', ', $mainTraits).'</>');
        $this->line('Selectable variants (from TraitClone): <fg=white>'.count($variantTraits).' options</>');
        foreach ($variantTraits as $i => $trait) {
            $this->line("  <fg=cyan>".($i + 1).".</> {$trait}");
        }
    }
}
