<?php

use App\Models\Champion;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\SetHooks\Shared\DisplayNameVariantHook;
use App\Services\Import\SetHooks\Shared\RoleInferenceHook;
use App\Services\Import\SetHooks\Shared\TraitEvolutionHook;
use App\Services\Import\SetHooks\Shared\TraitSlotOverrideHook;
use App\Services\Scout\ScoutContextBuilder;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->set = Set::factory()->create(['number' => 18]);

    $this->champion = fn (string $apiName, string $name, array $attrs = []) => Champion::factory()->create([
        'set_id' => $this->set->id,
        'api_name' => $apiName,
        'name' => $name,
        ...$attrs,
    ]);

    $this->trait = fn (string $apiName) => TftTrait::create([
        'set_id' => $this->set->id,
        'api_name' => $apiName,
        'name' => $apiName,
        'category' => 'public',
        'is_unique' => false,
    ]);
});

test('lux forms become variants of a non-playable base', function () {
    $base = ($this->champion)('DA_Lux18_Base', 'Lux', [
        'cost' => 5,
        'planner_code' => 1029,
        'ability_stats' => [['name' => 'ManaCalc1', 'value' => [0, 10, 20, 30]]],
    ]);
    $coven = ($this->champion)('DA_18_Lux_Coven', 'Lux (Coven)', ['cost' => 5]);

    (new DisplayNameVariantHook)->run($this->set);

    $coven->refresh();
    expect($base->fresh()->is_playable)->toBeFalse()
        ->and($coven->base_champion_id)->toBe($base->id)
        ->and($coven->variant_label)->toBe('coven')
        // The Team Planner only knows the base unit
        ->and($coven->planner_code)->toBe(1029)
        // Form bins have no SpellObject — stats come from the base spell
        ->and($coven->ability_stats[0]['name'])->toBe('ManaCalc1');
});

test('display name link requires matching cost', function () {
    ($this->champion)('DA_X18', 'Gnar', ['cost' => 5]);
    $other = ($this->champion)('DA_Y18', 'Gnar (Mega)', ['cost' => 3]);

    (new DisplayNameVariantHook)->run($this->set);

    expect($other->fresh()->base_champion_id)->toBeNull();
});

test('apex predator takes two slots', function () {
    $elder = ($this->champion)('DA_18_ElderDragon', 'Elder Dragon', ['cost' => 5]);
    $elder->traits()->attach(($this->trait)('DA_18_ApexPredator')->id);
    $other = ($this->champion)('DA_18_Ahri', 'Ahri', ['cost' => 4]);

    (new TraitSlotOverrideHook)->run($this->set);

    expect($elder->fresh()->slots_used)->toBe(2)
        ->and($other->fresh()->slots_used)->toBe(1);
});

test('roles are inferred from range, damage words and fighter traits', function () {
    $carry = ($this->champion)('DA_18_Aphelios', 'Aphelios', ['range' => 4,
        'ability_desc' => 'Swipe the target dealing @X@ %i:scaleAD% physical damage, then @Y@ %i:scaleAP%.']);
    $caster = ($this->champion)('DA_18_Ahri', 'Ahri', ['range' => 4,
        'ability_desc' => 'It deals @MagicDamageCalc1@ %i:scaleAP% magic damage.']);
    $tank = ($this->champion)('DA_18_Leona', 'Leona', ['range' => 1,
        'ability_desc' => 'Gain @Shield@ %i:scaleAP% Shield and deal magic damage.']);
    $fighter = ($this->champion)('DA_18_Warwick', 'Warwick', ['range' => 1,
        'ability_desc' => 'Bite for @Dmg@ %i:scaleAD% physical damage.']);
    $fighter->traits()->attach(($this->trait)('DA_18_Slayer')->id);
    $riotRole = ($this->champion)('DA_18_Kept', 'Kept', ['range' => 4,
        'ability_desc' => 'magic damage', 'role' => 'ADTank']);

    (new RoleInferenceHook)->run($this->set);

    $roleOf = fn (Champion $c) => [$c->fresh()->role, $c->fresh()->damage_type, $c->fresh()->role_category];

    expect($roleOf($carry))->toBe(['ADCarry', 'AD', 'Carry'])
        ->and($roleOf($caster))->toBe(['APCaster', 'AP', 'Caster'])
        ->and($roleOf($tank))->toBe(['APTank', 'AP', 'Tank'])
        ->and($roleOf($fighter))->toBe(['ADFighter', 'AD', 'Fighter'])
        // CDragon-supplied roles are left alone
        ->and($riotRole->fresh()->role)->toBe('ADTank');
});

test('kha\'zix gets a form per combination of evolutions', function () {
    config(['tft.sets.18.unscored_traits' => ['DA_18_KhaZix' => ['DA_18_Rival']]]);
    config(['tft.sets.18.evolutions' => [
        'DA_18_KhaZix' => [
            'choices' => ['DA_18_Executioner', 'DA_18_Slayer', 'DA_18_Spellweaver', 'DA_18_Missing'],
            'max' => 2,
            'auto_max' => 1,
        ],
    ]]);
    $rival = ($this->trait)('DA_18_Rival');
    ($this->trait)('DA_18_Executioner')->update(['name' => 'Executioner']);
    ($this->trait)('DA_18_Slayer')->update(['name' => 'Ravager']);
    ($this->trait)('DA_18_Spellweaver')->update(['name' => 'Spellweaver']);
    $base = ($this->champion)('DA_18_KhaZix', "Kha'Zix", [
        'cost' => 3,
        'role' => 'APFighter',
        'planner_code' => 777,
    ]);
    $base->traits()->attach($rival->id, ['amount' => 1]);

    (new TraitEvolutionHook)->run($this->set);

    // 3 single picks + 3 pairs; the missing trait is skipped, max caps at 2
    expect(Champion::where('base_champion_id', $base->id)->orderBy('id')->pluck('api_name')->all())->toBe([
        'DA_18_KhaZix_Executioner',
        'DA_18_KhaZix_Ravager',
        'DA_18_KhaZix_Spellweaver',
        'DA_18_KhaZix_Executioner_Ravager',
        'DA_18_KhaZix_Executioner_Spellweaver',
        'DA_18_KhaZix_Ravager_Spellweaver',
    ]);

    // Picks beyond auto_max are lock-only: the scout fields them only on a lock
    expect(Champion::where('base_champion_id', $base->id)->pluck('lock_only', 'api_name')->all())->toBe([
        'DA_18_KhaZix_Executioner' => false,
        'DA_18_KhaZix_Ravager' => false,
        'DA_18_KhaZix_Spellweaver' => false,
        'DA_18_KhaZix_Executioner_Ravager' => true,
        'DA_18_KhaZix_Executioner_Spellweaver' => true,
        'DA_18_KhaZix_Ravager_Spellweaver' => true,
    ]);

    $form = Champion::where('api_name', 'DA_18_KhaZix_Executioner_Ravager')->firstOrFail();
    expect($form->name)->toBe("Kha'Zix (Executioner + Ravager)")
        ->and($form->variant_label)->toBe('executioner-ravager')
        ->and($form->is_playable)->toBeTrue()
        ->and($form->cost)->toBe(3)
        ->and($form->role)->toBe('APFighter')
        ->and($form->planner_code)->toBe(777)
        ->and($form->traits()->pluck('amount', 'api_name')->all())
        ->toEqual(['DA_18_Rival' => 1, 'DA_18_Executioner' => 1, 'DA_18_Slayer' => 1])
        // Unevolved Kha'Zix stays a legal pick
        ->and($base->fresh()->is_playable)->toBeTrue()
        ->and($base->traits()->pluck('api_name')->all())->toBe(['DA_18_Rival']);

    // One Kha'Zix per board: base and every form share an exclusion group
    config(['services.tft.set' => 18]);
    $context = app(ScoutContextBuilder::class)->build(18);
    expect(collect($context['exclusionGroups'])->firstWhere(fn ($g) => in_array('DA_18_KhaZix', $g)))->toHaveCount(7)
        ->and(collect($context['champions'])->pluck('lockOnly', 'apiName')->only(['DA_18_KhaZix', 'DA_18_KhaZix_Ravager', 'DA_18_KhaZix_Ravager_Spellweaver'])->all())
        ->toBe(['DA_18_KhaZix' => false, 'DA_18_KhaZix_Ravager' => false, 'DA_18_KhaZix_Ravager_Spellweaver' => true])
        // Rival stays on every Kha'Zix but scores nothing for him
        ->and(collect($context['champions'])->filter(fn ($c) => str_starts_with($c['apiName'], 'DA_18_KhaZix'))->pluck('unscoredTraits')->unique()->values()->all())
        ->toBe([['DA_18_Rival']])
        ->and(collect($context['champions'])->firstWhere('apiName', 'DA_18_KhaZix_Ravager')['traits'])->toContain('DA_18_Rival');
});

test('evolution combinations cover every pick count once', function () {
    $all = TraitEvolutionHook::combinations(['E', 'R', 'V', 'S'], 4);

    expect($all)->toHaveCount(15)
        ->and(collect($all)->countBy(fn ($c) => count($c))->all())->toBe([1 => 4, 2 => 6, 3 => 4, 4 => 1])
        ->and($all[14])->toBe(['E', 'R', 'V', 'S'])
        ->and(TraitEvolutionHook::combinations(['E', 'R'], 1))->toBe([['E'], ['R']]);
});
