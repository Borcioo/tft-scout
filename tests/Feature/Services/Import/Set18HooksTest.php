<?php

namespace Tests\Feature\Services\Import;

use App\Models\Champion;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\SetHooks\Shared\DisplayNameVariantHook;
use App\Services\Import\SetHooks\Shared\RoleInferenceHook;
use App\Services\Import\SetHooks\Shared\TraitSlotOverrideHook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class Set18HooksTest extends TestCase
{
    use RefreshDatabase;

    private Set $set;

    protected function setUp(): void
    {
        parent::setUp();
        $this->set = Set::factory()->create(['number' => 18]);
    }

    public function test_lux_forms_become_variants_of_a_non_playable_base(): void
    {
        $base = $this->champion('DA_Lux18_Base', 'Lux', cost: 5, plannerCode: 1029);
        $coven = $this->champion('DA_18_Lux_Coven', 'Lux (Coven)', cost: 5);
        $base->update(['ability_stats' => [['name' => 'ManaCalc1', 'value' => [0, 10, 20, 30]]]]);

        (new DisplayNameVariantHook)->run($this->set);

        $coven->refresh();
        $this->assertFalse($base->fresh()->is_playable);
        $this->assertSame($base->id, $coven->base_champion_id);
        $this->assertSame('coven', $coven->variant_label);
        // The Team Planner only knows the base unit
        $this->assertSame(1029, $coven->planner_code);
        // Form bins have no SpellObject — stats come from the base spell
        $this->assertSame('ManaCalc1', $coven->ability_stats[0]['name']);
    }

    public function test_display_name_link_requires_matching_cost(): void
    {
        $this->champion('DA_X18', 'Gnar', cost: 5);
        $other = $this->champion('DA_Y18', 'Gnar (Mega)', cost: 3);

        (new DisplayNameVariantHook)->run($this->set);

        $this->assertNull($other->fresh()->base_champion_id);
    }

    public function test_apex_predator_takes_two_slots(): void
    {
        $apex = $this->trait('DA_18_ApexPredator');
        $elder = $this->champion('DA_18_ElderDragon', 'Elder Dragon', cost: 5);
        $elder->traits()->attach($apex->id);
        $other = $this->champion('DA_18_Ahri', 'Ahri', cost: 4);

        (new TraitSlotOverrideHook)->run($this->set);

        $this->assertSame(2, $elder->fresh()->slots_used);
        $this->assertSame(1, $other->fresh()->slots_used);
    }

    public function test_roles_are_inferred_from_range_damage_words_and_fighter_traits(): void
    {
        $ravager = $this->trait('DA_18_Slayer');

        $carry = $this->champion('DA_18_Aphelios', 'Aphelios', range: 4,
            desc: 'Swipe the target dealing @X@ %i:scaleAD% physical damage, then @Y@ %i:scaleAP%.');
        $caster = $this->champion('DA_18_Ahri', 'Ahri', range: 4,
            desc: 'It deals @MagicDamageCalc1@ %i:scaleAP% magic damage.');
        $tank = $this->champion('DA_18_Leona', 'Leona', range: 1,
            desc: 'Gain @Shield@ %i:scaleAP% Shield and deal magic damage.');
        $fighter = $this->champion('DA_18_Warwick', 'Warwick', range: 1,
            desc: 'Bite for @Dmg@ %i:scaleAD% physical damage.');
        $fighter->traits()->attach($ravager->id);
        $riotRole = $this->champion('DA_18_Kept', 'Kept', range: 4, desc: 'magic damage');
        $riotRole->update(['role' => 'ADTank']);

        (new RoleInferenceHook)->run($this->set);

        $this->assertSame(['ADCarry', 'AD', 'Carry'], $this->roleOf($carry));
        $this->assertSame(['APCaster', 'AP', 'Caster'], $this->roleOf($caster));
        $this->assertSame(['APTank', 'AP', 'Tank'], $this->roleOf($tank));
        $this->assertSame(['ADFighter', 'AD', 'Fighter'], $this->roleOf($fighter));
        // CDragon-supplied roles are left alone
        $this->assertSame('ADTank', $riotRole->fresh()->role);
    }

    private function champion(
        string $apiName,
        string $name,
        int $cost = 1,
        ?int $plannerCode = null,
        float $range = 1,
        string $desc = '',
    ): Champion {
        return Champion::factory()->create([
            'set_id' => $this->set->id,
            'api_name' => $apiName,
            'name' => $name,
            'cost' => $cost,
            'planner_code' => $plannerCode,
            'range' => $range,
            'ability_desc' => $desc,
        ]);
    }

    private function trait(string $apiName): TftTrait
    {
        return TftTrait::create([
            'set_id' => $this->set->id,
            'api_name' => $apiName,
            'name' => $apiName,
            'category' => 'public',
            'is_unique' => false,
        ]);
    }

    /** @return array{string|null, string|null, string|null} */
    private function roleOf(Champion $c): array
    {
        $c->refresh();

        return [$c->role, $c->damage_type, $c->role_category];
    }
}
