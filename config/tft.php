<?php

/**
 * TFT-specific configuration — currently only UX metadata that can't be
 * derived automatically from CDragon BIN files.
 *
 * Variant mechanic detection (which champions have selectable variants,
 * which traits each variant contributes) is fully automated via
 * App\Services\Tft\CharacterBinInspector. What we CAN'T derive is:
 *   - Human-readable variant label (Riot's internal trait api_name is
 *     e.g. "TFT17_ManaTrait" but players call that form "Conduit Mode")
 *   - Role / damage type / role category (inherited from gameplay, not
 *     exposed in BIN fields we can read)
 *
 * Those come from `variant_overrides` keyed by the variant trait's api_name.
 * Absent entries fall back to a default label derived from the api_name
 * and null role — still functional, just less polished.
 *
 * When a new set introduces a variant-choice champion, add its three
 * entries here and rerun `php artisan tft:import`.
 */
return [
    'variant_overrides' => [
        // Miss Fortune Set 17 — 3 selectable modes, sourced from
        // tft.stringtable.json "Conduit Mode" / "Challenger Mode" /
        // "Replicator Mode" entries (see research/tft-character-bins-mechanics.md).
        //
        // stance_spell matches the SUFFIX of a SpellObject's mScriptName in
        // the character bin — e.g. "ManaTraitStance" matches
        // TFT17_MissFortuneSpell_ManaTraitStance. Used by VariantChoiceHook
        // to pick the right per-variant ability description.
        //
        // NB: Riot's internal spell names don't match the trait api_names
        // (TFT17_APTrait → spell named FlexTraitStance → user-facing
        // "Replicator Mode"). This mapping is therefore explicit.
        'TFT17_ManaTrait' => [
            'variant_label' => 'conduit',
            'role' => 'APCaster',
            'damage_type' => 'AP',
            'role_category' => 'Caster',
            'stance_spell' => 'ManaTraitStance',
        ],
        'TFT17_ASTrait' => [
            'variant_label' => 'challenger',
            'role' => 'ADCarry',
            'damage_type' => 'AD',
            'role_category' => 'Carry',
            'stance_spell' => 'ASTraitStance',
        ],
        'TFT17_APTrait' => [
            'variant_label' => 'replicator',
            'role' => 'APCaster',
            'damage_type' => 'AP',
            'role_category' => 'Caster',
            'stance_spell' => 'FlexTraitStance',
        ],
    ],
    'metatft' => [
        'min_games_gate' => 15,
        'tier_thresholds' => [
            // avg_place upper bound (inclusive) per tier
            'SS' => 3.5,
            'S' => 4.0,
            'A' => 4.3,
            'B' => 4.6,
            'C' => 5.0,
            // D = everything above C
        ],
    ],
];
