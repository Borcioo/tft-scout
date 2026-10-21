<?php

use App\Models\Champion;
use App\Models\ChampionRating;
use App\Models\Set;
use App\Services\MetaTft\Dto\UnitRatingDto;
use App\Services\MetaTft\MetaTftClient;
use App\Services\MetaTft\MetaTftSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

test('star rows fold into first-copy stars with carried games', function () {
    Http::fake(function (Request $request) {
        if (! isset($request->data()['patch'])) {
            return Http::response(['games' => [['patch' => '18.4', 'b_patch_version' => 'b', 'count' => 6_000_000]], 'results' => []]);
        }

        return Http::response(['data' => [
            ['unit_tier_numitems_unique' => null, 'placement_count' => [9, 9, 9, 9, 9, 9, 9, 9]],
            ['unit_tier_numitems_unique' => 'DA_18_Kayle-1_2_0', 'placement_count' => [0, 0, 0, 0, 1, 1, 1, 1]],
            ['unit_tier_numitems_unique' => 'DA_18_Kayle-1_3_3', 'placement_count' => [2, 2, 0, 0, 0, 0, 0, 0]],
            // 4★ (special mechanics) counts as 3★
            ['unit_tier_numitems_unique' => 'DA_18_Kayle-1_4_3', 'placement_count' => [1, 0, 0, 0, 0, 0, 0, 0]],
            // A second Kayle on the board is not the unit's own game
            ['unit_tier_numitems_unique' => 'DA_18_Kayle-2_2_0', 'placement_count' => [5, 0, 0, 0, 0, 0, 0, 0]],
        ]]);
    });

    $stars = app(MetaTftClient::class)->fetchUnitStars();

    expect($stars['DA_18_Kayle'][2])->toBe(['places' => [0, 0, 0, 0, 1, 1, 1, 1], 'carryGames' => 0])
        ->and($stars['DA_18_Kayle'][3])->toBe(['places' => [3, 2, 0, 0, 0, 0, 0, 0], 'carryGames' => 5])
        ->and($stars['DA_18_Kayle'])->not->toHaveKey(4);

    $starRequest = collect(Http::recorded())->first(
        fn ($pair) => str_contains($pair[0]->url(), 'unit_tier_numitems_unique'),
    );
    expect($starRequest[0]->data())->toMatchArray(['patch' => '18.4', 'b_patch' => 'b', 'permit_filter_adjustment' => 'false']);
});

test('the sync writes star stats onto this patch\'s unit rating', function () {
    $set = Set::factory()->create(['number' => 18]);
    $kayle = Champion::factory()->create(['set_id' => $set->id, 'api_name' => 'DA_18_Kayle', 'cost' => 2]);

    $client = Mockery::mock(MetaTftClient::class);
    $client->shouldReceive('resetRunCache');
    $client->shouldReceive('resolvePatch')->andReturn(['patch' => '18.4', 'b_patch' => 'b', 'label' => '18.4b', 'games' => 1000000]);
    $client->shouldReceive('fetchUnits')->andReturn([
        new UnitRatingDto('DA_18_Kayle', 4.4, 0.13, 0.53, 1000, '18.4b'),
    ]);
    $client->shouldReceive('fetchUnitStars')->andReturn([
        'DA_18_Kayle' => [
            2 => ['places' => [0, 0, 0, 0, 1, 1, 1, 1], 'carryGames' => 1],
            3 => ['places' => [3, 1, 0, 0, 0, 0, 0, 0], 'carryGames' => 4],
        ],
    ]);
    foreach (['fetchTraits', 'fetchMetaComps', 'fetchAffinity', 'fetchCompanions', 'fetchItemStats', 'fetchItemBuilds'] as $method) {
        $client->shouldReceive($method)->andReturn([]);
    }
    $client->shouldReceive('fetchTotalGames')->andReturn(0);

    (new MetaTftSync($client))->run(18);

    expect(ChampionRating::where('champion_id', $kayle->id)->value('star_stats'))->toBe([
        '2' => ['games' => 4, 'avgPlace' => 6.5, 'carryGames' => 1],
        '3' => ['games' => 4, 'avgPlace' => 1.25, 'carryGames' => 4],
    ]);
});

test('a failed star fetch leaves the ratings and the sync intact', function () {
    $set = Set::factory()->create(['number' => 18]);
    Champion::factory()->create(['set_id' => $set->id, 'api_name' => 'DA_18_Kayle', 'cost' => 2]);

    $client = Mockery::mock(MetaTftClient::class);
    $client->shouldReceive('resetRunCache');
    $client->shouldReceive('resolvePatch')->andReturn(['patch' => '18.4', 'b_patch' => 'b', 'label' => '18.4b', 'games' => 1000000]);
    $client->shouldReceive('fetchUnits')->andReturn([new UnitRatingDto('DA_18_Kayle', 4.4, 0.13, 0.53, 1000, '18.4b')]);
    $client->shouldReceive('fetchUnitStars')->andThrow(new RuntimeException('HTTP 500'));
    foreach (['fetchTraits', 'fetchMetaComps', 'fetchAffinity', 'fetchCompanions', 'fetchItemStats', 'fetchItemBuilds'] as $method) {
        $client->shouldReceive($method)->andReturn([]);
    }
    $client->shouldReceive('fetchTotalGames')->andReturn(0);

    $sync = (new MetaTftSync($client))->run(18);

    expect($sync->status)->not->toBe('failed')
        ->and(ChampionRating::first()->star_stats)->toBeNull()
        ->and(ChampionRating::first()->avg_place)->toBe(4.4);
});
