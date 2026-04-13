<?php

namespace App\Services\Tft;

use App\Models\Champion;

/**
 * Resolves hashed stat field keys on TFTCharacterRecord to readable stat
 * names. Two layers in order of preference:
 *
 *   1. `TftStatHashRegistry` — hardcoded hash → name map, empirically
 *      verified against LoL Ahri and TFT MF. This covers the stable
 *      CharacterRecord fields that both CDTB and we know about, without
 *      knowing their original plaintext names.
 *
 *   2. Value-matching (Rosetta Stone) — fallback for fields that aren't
 *      in the registry. Fetches the reference champion's BIN, compares
 *      each hashed numeric value against the stats we have in the DB,
 *      assigns unique matches. Catches future fields Riot might add.
 *
 * The registry is the fast path and resolves every known stat field
 * deterministically. Value matching is only invoked when the inspector
 * finds a hash that isn't in the registry.
 *
 * See docs/research/tft-hash-discovery.md for the full story.
 */
class StatHashResolver
{
    /** Reference champion for Rosetta Stone fallback. */
    private const REFERENCE_API_NAME = 'TFT17_MissFortune';

    /** @var array<string, string>|null Lazy cache: hash (wrapped) → stat name */
    private ?array $valueMatchMap = null;

    public function __construct(
        private readonly CharacterBinInspector $inspector,
    ) {}

    /**
     * Resolve a set of hashed stat values to a structured list with names.
     *
     * Order of lookup per hash:
     *   1. Hardcoded registry (fast, deterministic)
     *   2. Value-matched map (built lazily from reference champion)
     *   3. null — unresolved, leave as-is
     *
     * @param  array<string, int|float>  $hashedStats  hash => numeric value
     * @return list<array{hash: string, stat: string|null, value: int|float, source: string}>
     */
    public function resolve(array $hashedStats): array
    {
        $out = [];
        foreach ($hashedStats as $hash => $value) {
            $name = TftStatHashRegistry::lookup($hash);
            $source = 'registry';

            if ($name === null) {
                $this->ensureValueMatchMapBuilt();
                $name = $this->valueMatchMap[$hash] ?? null;
                $source = $name !== null ? 'value-match' : 'unresolved';
            }

            $out[] = [
                'hash' => $hash,
                'stat' => $name,
                'value' => $value,
                'source' => $source,
            ];
        }

        return $out;
    }

    /**
     * Build the value-matched map only once — fetches the reference champion,
     * compares hashed stat values against DB stats. Only hashes NOT already
     * in the registry get a chance at value matching.
     */
    private function ensureValueMatchMapBuilt(): void
    {
        if ($this->valueMatchMap !== null) {
            return;
        }

        $this->valueMatchMap = [];

        $reference = Champion::where('api_name', self::REFERENCE_API_NAME)->first();
        if (! $reference) {
            return;
        }

        try {
            $report = $this->inspector->inspect(self::REFERENCE_API_NAME);
        } catch (\Throwable) {
            return; // inspector failures shouldn't break imports
        }

        $hashedStats = $report['main']['hashed_stats'] ?? [];

        $knownStats = [
            'hp' => (float) $reference->hp,
            'mana' => (float) $reference->mana,
            'start_mana' => (float) $reference->start_mana,
            'armor' => (float) $reference->armor,
            'magic_resist' => (float) $reference->magic_resist,
            'attack_damage' => (float) $reference->attack_damage,
            'attack_speed' => (float) $reference->attack_speed,
            'range' => (float) $reference->range * 100, // hex → units approx
        ];

        foreach ($knownStats as $statName => $statValue) {
            $matches = [];
            foreach ($hashedStats as $hash => $binValue) {
                if (TftStatHashRegistry::lookup($hash) !== null) {
                    continue; // registry already owns this hash
                }
                if (isset($this->valueMatchMap[$hash])) {
                    continue;
                }
                if ($this->valuesEqual($binValue, $statValue)) {
                    $matches[] = $hash;
                }
            }
            if (count($matches) === 1) {
                $this->valueMatchMap[$matches[0]] = $statName;
            }
        }
    }

    /**
     * Float equality tolerating f32→f64 rounding artifacts from CDragon
     * (values like 0.10000000149012 should match 0.1).
     */
    private function valuesEqual(float|int $a, float|int $b): bool
    {
        return abs((float) $a - (float) $b) < 0.001;
    }
}
