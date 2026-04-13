<?php

namespace App\Services\Import\SetHooks\Set17;

use App\Models\Champion;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\Contracts\PostImportHook;

/**
 * In Set 17, champions with the Mecha trait unlock "Enhanced" forms at higher
 * Mecha breakpoints. Enhanced forms:
 *   - Occupy 2 board slots instead of 1 (slots_used = 2)
 *   - Share stats/abilities with base (CDragon doesn't expose enhanced stats)
 *   - Count as 2× their trait count for breakpoint math
 *
 * CDragon does NOT export these variants — we synthesize one per Mecha base.
 * Verified via API fetch: `enhancedChamps.length === 0` in CDragon Set 17.
 *
 * Base Mecha champs remain is_playable=true (player can field base before
 * hitting the enhancement breakpoint). Enhanced variants are also playable
 * but are mutually exclusive with their base via base_champion_id semantics.
 */
class MechaEnhancedHook implements PostImportHook
{
    private const MECHA_TRAIT_API_NAME = 'TFT17_Mecha';

    public function name(): string
    {
        return 'MechaEnhanced';
    }

    public function run(Set $set): void
    {
        $mechaTrait = TftTrait::query()
            ->where('set_id', $set->id)
            ->where('api_name', self::MECHA_TRAIT_API_NAME)
            ->first();

        if (! $mechaTrait) {
            return; // Set doesn't have Mecha trait
        }

        // Base champions (not variants themselves) with Mecha trait
        $mechaChamps = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('base_champion_id')
            ->whereHas('traits', fn ($q) => $q->where('traits.id', $mechaTrait->id))
            ->get();

        foreach ($mechaChamps as $base) {
            $this->createEnhanced($base);
        }
    }

    private function createEnhanced(Champion $base): void
    {
        // Check for a manual enhanced ability override.
        // CDragon doesn't expose enhanced-form abilities, so champions with
        // transcribed in-game data use the override; others fall back to
        // copying base ability values (incorrect but best-effort placeholder).
        $override = EnhancedMechaAbilities::forBase($base->api_name);

        $enhanced = Champion::create([
            'set_id' => $base->set_id,
            'api_name' => $base->api_name.'_enhanced',
            'name' => $base->name.' (Enhanced)',
            'cost' => $base->cost,

            // KEY: Enhanced takes 2 slots. Algorithm engine uses this for
            // trait count math: 1 enhanced mecha = 2 mecha for breakpoints.
            'slots_used' => 2,

            'role' => $base->role,
            'damage_type' => $base->damage_type,
            'role_category' => $base->role_category,
            'is_playable' => true,

            // Copy stats — CDragon has no enhanced-specific stat values,
            // and in-game enhancement is primarily ability-based anyway.
            'hp' => $base->hp,
            'armor' => $base->armor,
            'magic_resist' => $base->magic_resist,
            'attack_damage' => $base->attack_damage,
            'attack_speed' => $base->attack_speed,
            'mana' => $base->mana,
            'start_mana' => $base->start_mana,
            'range' => $base->range,
            'crit_chance' => $base->crit_chance,
            'crit_multiplier' => $base->crit_multiplier,

            // Use override if available, else fall back to base ability values
            'ability_desc' => $override['desc'] ?? $base->ability_desc,
            'ability_stats' => $override['variables'] ?? $base->ability_stats,

            'base_champion_id' => $base->id,
            'variant_label' => 'enhanced',

            'planner_code' => $base->planner_code,
            'icon_path' => $base->icon_path,
        ]);

        // Same traits as base — engine handles the 2× multiplier via slots_used
        $baseTraitIds = $base->traits()->pluck('traits.id')->all();

        if (! empty($baseTraitIds)) {
            $enhanced->traits()->sync($baseTraitIds);
        }
    }
}
