<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Services\Import\Contracts\PostImportHook;
use App\Support\SetProfile;

/**
 * Fill `role` / `damage_type` / `role_category` for champions CDragon
 * ships without one.
 *
 * Up to Set 17 en_us.json carried Riot's role ("ADCarry", "APTank"),
 * read from the character bin's CharacterRole. Set 18 records have no
 * CharacterRole at all, so every champion arrives with role = null and
 * the scout's role balance / min-frontline filters go blind. This hook
 * infers the role from data that is still there:
 *
 *   - damage type: whether the ability text deals more "physical" or
 *     "magic damage"; on a tie, which scaling icon it uses more
 *     (`%i:scaleAD%` vs `%i:scaleAP%`); H(ybrid) if still tied
 *   - category: ranged (≥ 4 hexes) → Carry (AD) / Caster (AP, H);
 *     shorter range → Fighter when the champion has one of the set's
 *     `fighter_traits` (config/tft.php), Tank otherwise
 *
 * It's a heuristic — the roles are ours, not Riot's — and only touches
 * rows CDragon left empty, so sets with real roles are unaffected.
 */
class RoleInferenceHook implements PostImportHook
{
    private const RANGED_MIN_HEXES = 4;

    public function name(): string
    {
        return 'RoleInference';
    }

    public function run(Set $set): void
    {
        $fighterTraits = array_flip(SetProfile::for($set->number)->fighterTraits);

        $champions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('role')
            ->with('traits:id,api_name')
            ->get();

        foreach ($champions as $champion) {
            $damageType = $this->damageType((string) $champion->ability_desc);

            if ($champion->range >= self::RANGED_MIN_HEXES) {
                $category = $damageType === 'AD' ? 'Carry' : 'Caster';
            } else {
                $isFighter = $champion->traits->contains(fn ($t) => isset($fighterTraits[$t->api_name]));
                $category = $isFighter ? 'Fighter' : 'Tank';
            }

            $champion->update([
                'role' => $damageType.$category,
                'damage_type' => $damageType,
                'role_category' => $category,
            ]);
        }
    }

    private function damageType(string $abilityDesc): string
    {
        $physical = preg_match_all('/physical damage/i', $abilityDesc);
        $magic = preg_match_all('/magic damage/i', $abilityDesc);
        if ($physical !== $magic) {
            return $physical > $magic ? 'AD' : 'AP';
        }

        $ad = substr_count($abilityDesc, 'scaleAD');
        $ap = substr_count($abilityDesc, 'scaleAP');

        return match (true) {
            $ad > $ap => 'AD',
            $ap > $ad => 'AP',
            default => 'H',
        };
    }
}
