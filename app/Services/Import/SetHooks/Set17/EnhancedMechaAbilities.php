<?php

namespace App\Services\Import\SetHooks\Set17;

/**
 * Manual override for Mecha Enhanced form abilities.
 *
 * CDragon does NOT expose enhanced-form ability data in its public TFT JSON
 * (verified via deep probe — searched main en_us.json, champion ability keys,
 * trait definitions, character subfiles; all turned up empty). The Mecha
 * trait description literally says "upgrading their ability" but the enhanced
 * ability values live only in the game engine.
 *
 * This file holds manually transcribed data for each Mecha Enhanced form,
 * sourced from in-game observation. Each entry provides:
 *
 *   - desc: template with @VarName@ and @VarName*N@ placeholders, matching
 *           CDragon's convention so the frontend parser handles it uniformly
 *   - variables: array of {name, value: [1★, 2★, 3★]} entries
 *
 * When a new Mecha is added (future sets or mid-set patches), add its entry
 * here. Entries with value `null` are stubs for champions we don't yet have
 * data for — they fall back to base-copy behavior in MechaEnhancedHook.
 *
 * To add a new champion's data:
 *  1. Observe the enhanced ability in-game (tooltip values at 1★/2★/3★)
 *  2. Write a template description with @Placeholder@ syntax
 *  3. List each variable with its 3-star value array
 *
 * Star-level note: Mecha Enhanced form technically only exists when the
 * base Mecha is at least 2★ (enhancement triggers via trait breakpoint).
 * We still populate the 1★ position to keep array consistency, using the
 * same value as 2★ or zero (game logic will never actually display it).
 */
class EnhancedMechaAbilities
{
    /**
     * Base champion api_name → enhanced ability override data.
     *
     * @return array{desc: string, variables: list<array{name: string, value: list<float>}>}|null
     */
    public static function forBase(string $baseApiName): ?array
    {
        return self::ABILITIES[$baseApiName] ?? null;
    }

    private const ABILITIES = [
        'TFT17_Galio' => [
            'desc' => 'Enter a defensive stance for @DurabilityDuration@ seconds, gaining <TFTBonus>@Durability*100@%</TFTBonus> Durability, healing <scaleHealth>@Heal@&nbsp;(%i:scaleAP%)</scaleHealth>, and attracting nearby enemy projectiles.<br><br>As the stance ends, deal <physicalDamage>@InitialDamage@&nbsp;(%i:scaleAD%)</physicalDamage> physical damage in a @HexRange@-hex range. Then slam down in a line towards the current target, dealing <physicalDamage>@SlamDamage@&nbsp;(%i:scaleAD%)</physicalDamage> physical damage to all enemies hit, and creating a shockwave that deals <physicalDamage>@ShockwaveDamagePercent*100@%&nbsp;(%i:scaleArmor%%i:scaleMR%)</physicalDamage> physical damage in a @HexRange@-hex range.',
            'variables' => [
                ['name' => 'DurabilityDuration', 'value' => [4, 4, 4]],
                ['name' => 'Durability', 'value' => [0.2, 0.2, 0.9]],
                ['name' => 'Heal', 'value' => [850, 1200, 3000]],
                ['name' => 'InitialDamage', 'value' => [100, 150, 1500]],
                ['name' => 'SlamDamage', 'value' => [200, 300, 4000]],
                // "Percent" suffix triggers isPercentStat detection so the
                // raw values table renders 96%/144%/1200% consistently instead
                // of the mixed fallback format (96% / 1.4 / 12).
                ['name' => 'ShockwaveDamagePercent', 'value' => [0.96, 1.44, 12.0]],
                ['name' => 'HexRange', 'value' => [2, 2, 2]],
            ],
        ],

        // TODO: User to provide data in this format for the remaining Mecha champs
        'TFT17_Urgot' => null,
        'TFT17_AurelionSol' => null,
    ];
}
