<?php

use App\Models\Champion;
use App\Models\ChampionRating;
use App\Models\Set;
use App\Models\TftTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.tft.set' => 18]);
    $set = Set::factory()->create(['number' => 18]);

    $riftbeast = TftTrait::create([
        'set_id' => $set->id,
        'api_name' => 'DA_Riftbeast18',
        'name' => 'Riftbeast',
        'description' => '(@MinUnits@) Alpha Mark (@MinUnits@) +@TeamSize@ maximum team size',
        'category' => 'public',
    ]);
    $riftbeast->breakpoints()->create(['position' => 1, 'min_units' => 3, 'max_units' => 9, 'style_id' => 1, 'effects' => []]);
    $riftbeast->breakpoints()->create(['position' => 2, 'min_units' => 10, 'max_units' => 25000, 'style_id' => 5, 'effects' => ['TeamSize' => 2.0]]);

    $coven = TftTrait::create([
        'set_id' => $set->id, 'api_name' => 'DA_18_Coven', 'name' => 'Coven', 'category' => 'public',
    ]);
    $coven->breakpoints()->create(['position' => 1, 'min_units' => 3, 'max_units' => 25000, 'style_id' => 1, 'effects' => []]);

    $elder = Champion::factory()->create([
        'set_id' => $set->id, 'api_name' => 'DA_18_ElderDragon', 'name' => 'Elder Dragon', 'cost' => 5, 'slots_used' => 2,
    ]);
    $elder->traits()->attach($riftbeast->id, ['amount' => 2]);

    $lux = Champion::factory()->create([
        'set_id' => $set->id, 'api_name' => 'DA_Lux18_Base', 'name' => 'Lux', 'cost' => 5, 'is_playable' => false,
    ]);
    foreach (['DA_18_Lux_Coven' => 'coven', 'DA_18_Lux_Fae' => 'fae'] as $api => $label) {
        $form = Champion::factory()->create([
            'set_id' => $set->id, 'api_name' => $api, 'name' => "Lux ({$label})", 'cost' => 5,
            'base_champion_id' => $lux->id, 'variant_label' => $label,
        ]);
        if ($label === 'coven') {
            $form->traits()->attach($coven->id, ['amount' => 2]);
        }
    }

    // A previous set's rows must not leak into the current context
    $old = Set::factory()->create(['number' => 17, 'is_active' => false]);
    Champion::factory()->create(['set_id' => $old->id, 'api_name' => 'TFT17_Jinx']);
});

test('context endpoint returns the worker payload shape', function () {
    $this->getJson('/api/scout/context')
        ->assertOk()
        ->assertJsonStructure([
            'champions' => [['apiName', 'cost', 'traits', 'traitAmounts', 'slotsUsed', 'baseApiName', 'variant', 'role']],
            'traits' => [['apiName', 'category', 'breakpoints' => [['position', 'minUnits', 'maxUnits', 'style', 'teamSizeBonus']]]],
            'exclusionGroups',
            'scoringCtx' => ['unitRatings', 'traitRatings', 'affinity', 'companions', 'metaComps', 'styleScores'],
            'syncedAt',
            'stale',
        ]);
});

test('only playable champions of the current set are sent', function () {
    $apis = collect($this->getJson('/api/scout/context')->json('champions'))->pluck('apiName')->sort()->values()->all();

    expect($apis)->toBe(['DA_18_ElderDragon', 'DA_18_Lux_Coven', 'DA_18_Lux_Fae']);
});

test('trait amounts and slots reach the worker', function () {
    $champions = collect($this->getJson('/api/scout/context')->json('champions'))->keyBy('apiName');

    expect($champions['DA_18_ElderDragon']['slotsUsed'])->toBe(2)
        ->and($champions['DA_18_ElderDragon']['traitAmounts'])->toBe(['DA_Riftbeast18' => 2])
        ->and($champions['DA_18_Lux_Coven']['traitAmounts'])->toBe(['DA_18_Coven' => 2])
        ->and($champions['DA_18_Lux_Coven']['baseApiName'])->toBe('DA_Lux18_Base')
        ->and($champions['DA_18_Lux_Fae']['traitAmounts'])->toBe([]);
});

test('team size bonus is resolved per breakpoint', function () {
    $traits = collect($this->getJson('/api/scout/context')->json('traits'))->keyBy('apiName');

    expect(collect($traits['DA_Riftbeast18']['breakpoints'])->pluck('teamSizeBonus', 'minUnits')->all())
        ->toBe([3 => 0, 10 => 2]);
});

test('lux forms form one exclusion group', function () {
    $groups = $this->getJson('/api/scout/context')->json('exclusionGroups');

    expect($groups)->toHaveCount(1)
        ->and(collect($groups[0])->sort()->values()->all())->toBe(['DA_18_Lux_Coven', 'DA_18_Lux_Fae']);
});

test('unit ratings carry star stats when the sync has them', function () {
    $set = Set::where('number', 18)->first();
    $elder = Champion::where('api_name', 'DA_18_ElderDragon')->first();
    $lux = Champion::where('api_name', 'DA_18_Lux_Coven')->first();
    $stars = ['1' => ['games' => 900, 'avgPlace' => 5.1, 'carryGames' => 10], '3' => ['games' => 100, 'avgPlace' => 1.4, 'carryGames' => 80]];

    foreach ([[$elder, $stars], [$lux, null]] as [$champion, $starStats]) {
        ChampionRating::create([
            'champion_id' => $champion->id, 'set_id' => $set->id, 'patch' => '18.4b',
            'avg_place' => 4.2, 'win_rate' => 0.1, 'top4_rate' => 0.5, 'games' => 1000, 'score' => 0.6,
            'star_stats' => $starStats,
        ]);
    }

    $ratings = $this->getJson('/api/scout/context')->assertOk()->json('scoringCtx.unitRatings');

    expect($ratings['DA_18_ElderDragon']['stars'])->toBe($stars)
        ->and($ratings['DA_18_Lux_Coven'])->not->toHaveKey('stars');
});
