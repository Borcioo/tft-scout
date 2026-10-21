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
 *
 * `sets` holds the per-set quirks the importer, MetaTFT sync and scout
 * context can't derive from CDragon (see App\Support\SetProfile, which
 * also supplies defaults for sets missing here).
 */
return [
    'sets' => [
        17 => [
            'prefixes' => ['TFT17_'],
            // Set 17 equips the cross-set `TFT_Item_*` pool plus the
            // TFT5 radiants — the importer pulls them in with set_id NULL.
            'evergreen_items' => true,
            'fake_units' => [
                // Mini Black Hole (Dark Star trait summon)
                'TFT17_DarkStar_FakeUnit',
            ],
        ],
        18 => [
            // Set 18 ships every record (champions, traits, items,
            // components, augments, emblems) under the `DA_` namespace,
            // with the set number embedded in varying positions:
            // DA_18_Ahri, DA_Amumu18, DA_Gromp18_AP, DA_InfinityEdge.
            // MetaTFT reports a couple of summons as TFT18_*.
            'prefixes' => ['DA_', 'TFT18_'],
            // Set 18 has its own component + completed item records
            // (DA_Component_BFSword, DA_InfinityEdge, ...). The old
            // `TFT_Item_*` rows are not used in matches anymore.
            'evergreen_items' => false,
            'fake_units' => [],
            // "Apex Predator: Elder Dragon takes up 2 team slots" — the
            // only part of the mechanic not exposed as data (its +2
            // Riftbeast is the bin's mLinkedTraits Amount).
            'slots_by_trait' => [
                'DA_18_ApexPredator' => 2,
            ],
            // Set 18 data carries no champion roles (en_us.json `role`
            // is null, bins have no CharacterRole), so RoleInferenceHook
            // derives them from range + ability scaling. Melee units are
            // tanks unless they carry one of these traits.
            'fighter_traits' => [
                'DA_18_Slayer',   // Ravager — omnivamp bruisers
                'DA_18_Adaptor',  // Akali / Master Yi / Nidalee
                'DA_18_Rival',    // Kha'Zix / Rengar
            ],
            // Adaptor units flip between an AD and AP form depending on
            // items. CDragon lists one form per champion, MetaTFT reports
            // both under separate unit ids (DA_18_MasterYi_AD + _AP).
            // `_AD`/`_AP` siblings are folded automatically; only forms
            // whose id differs beyond the suffix need an entry here.
            'metatft_unit_aliases' => [
                'DA_NidaleeCougar18_AD' => 'DA_Nidalee18_AP',
            ],
            // Champions that permanently gain a trait of the player's
            // choice mid-game. Rival: "Takedowns evolve Kha'Zix, permanently
            // granting him your choice of Executioner, Rapidfire, Ravager,
            // or Spellweaver." Only the trait description says so — the
            // bin links just Rival — so TraitEvolutionHook adds one form
            // per choice (mutually exclusive with the unevolved base).
            'evolutions' => [
                'DA_18_KhaZix' => [
                    'DA_18_Executioner',
                    'DA_18_Rapidfire',
                    'DA_18_Slayer',       // Ravager
                    'DA_18_Spellweaver',
                ],
            ],
        ],
    ],

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
        // Minimum games to appear in per-champion tables/cards. Rows below
        // this threshold are noise (e.g. a 1.0 avg over 3 games is luck,
        // not signal). Distinct from `min_games_gate` which only gates
        // tier assignment — this gate hides the row entirely.
        'min_games_display' => 50,
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
