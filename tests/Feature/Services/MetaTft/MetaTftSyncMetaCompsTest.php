<?php

use App\Models\MetaComp;
use App\Models\Set;
use App\Services\MetaTft\Dto\MetaCompDto;
use App\Services\MetaTft\MetaTftClient;
use App\Services\MetaTft\MetaTftSync;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

test('meta comp cluster ids are unique per set, not globally', function () {
    // Production synced Set 17 from the PBE queue, which already served
    // Set 18 clusters — the Set 18 sync then hit the same cluster id.
    $old = Set::factory()->create(['number' => 17, 'is_active' => false]);
    MetaComp::create([
        'set_id' => $old->id, 'cluster_id' => '426000', 'external_id' => '426000',
        'name' => 'Old', 'avg_place' => 4.2, 'games' => 100, 'level' => 8,
    ]);
    $set = Set::factory()->create(['number' => 18]);

    $client = Mockery::mock(MetaTftClient::class);
    $client->shouldReceive('resetRunCache');
    $client->shouldReceive('resolvePatch')->andReturn(['patch' => '18.4', 'b_patch' => 'b', 'label' => '18.4b', 'games' => 1000000]);
    $client->shouldReceive('fetchUnits')->andReturn([]);
    $client->shouldReceive('fetchTraits')->andReturn([]);
    $client->shouldReceive('fetchMetaComps')->with(18)->andReturn([
        new MetaCompDto(id: '426000', name: 'Defender, Rengar', championApiNames: [], traitApiNames: [], avgPlace: 4.14, games: 10327, level: 7),
    ]);
    $client->shouldReceive('fetchAffinity')->andReturn([]);
    $client->shouldReceive('fetchCompanions')->andReturn([]);
    $client->shouldReceive('fetchItemStats')->andReturn([]);
    $client->shouldReceive('fetchItemBuilds')->andReturn([]);
    $client->shouldReceive('fetchTotalGames')->andReturn(0);

    (new MetaTftSync($client))->run(18);

    expect(MetaComp::where('set_id', $set->id)->pluck('cluster_id')->all())->toBe(['426000'])
        ->and(MetaComp::where('set_id', $old->id)->value('name'))->toBe('Old');
});
