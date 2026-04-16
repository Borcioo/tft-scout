<?php

namespace Tests\Feature\Services\MetaTft;

use App\Models\Champion;
use App\Models\ChampionItemBuild;
use App\Models\Item;
use App\Models\Set;
use App\Services\MetaTft\Dto\ItemBuildDto;
use App\Services\MetaTft\Dto\ItemStatDto;
use App\Services\MetaTft\MetaTftClient;
use App\Services\MetaTft\MetaTftSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class MetaTftSyncItemsTest extends TestCase
{
    use RefreshDatabase;

    public function test_first_sync_creates_item_stats_with_tier_no_change(): void
    {
        $set = Set::factory()->create(['number' => 17]);
        $champ = Champion::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT17_Test',
            'is_playable' => true,
        ]);
        $item = Item::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT_Item_Test',
        ]);

        $client = Mockery::mock(MetaTftClient::class);
        $client->shouldReceive('fetchUnits')->andReturn([]);
        $client->shouldReceive('fetchTraits')->andReturn([]);
        $client->shouldReceive('fetchMetaComps')->andReturn([]);
        $client->shouldReceive('fetchAffinity')->andReturn([]);
        $client->shouldReceive('fetchCompanions')->andReturn([]);
        $client->shouldReceive('fetchItemStats')
            ->with('TFT17_Test')
            ->andReturn([
                new ItemStatDto(
                    championApiName: 'TFT17_Test',
                    itemApiName: 'TFT_Item_Test',
                    avgPlace: 3.2,
                    winRate: 0.25,
                    top4Rate: 0.70,
                    games: 80,
                    frequency: 0.15,
                ),
            ]);
        $client->shouldReceive('fetchItemBuilds')->andReturn([]);
        $client->shouldReceive('fetchTotalGames')->andReturn(500);

        (new MetaTftSync($client))->run(17);

        $row = ChampionItemBuild::query()
            ->where('champion_id', $champ->id)
            ->where('item_id', $item->id)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('SS', $row->tier);
        $this->assertNull($row->place_change);
        $this->assertSame(80, $row->games);
        $this->assertEqualsWithDelta(3.2, $row->avg_place, 0.001);
    }

    public function test_second_sync_computes_place_change_and_updates_prev_avg(): void
    {
        $set = Set::factory()->create(['number' => 17]);
        $champ = Champion::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT17_Test',
            'is_playable' => true,
        ]);
        $item = Item::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT_Item_Test',
        ]);

        $run1 = new ItemStatDto('TFT17_Test', 'TFT_Item_Test', 4.5, 0.10, 0.50, 50, 0.10);
        $run2 = new ItemStatDto('TFT17_Test', 'TFT_Item_Test', 4.3, 0.12, 0.55, 60, 0.11);
        $stats = [$run1, $run2];

        $client = Mockery::mock(MetaTftClient::class);
        $client->shouldReceive('fetchUnits')->andReturn([]);
        $client->shouldReceive('fetchTraits')->andReturn([]);
        $client->shouldReceive('fetchMetaComps')->andReturn([]);
        $client->shouldReceive('fetchAffinity')->andReturn([]);
        $client->shouldReceive('fetchCompanions')->andReturn([]);
        $client->shouldReceive('fetchItemBuilds')->andReturn([]);
        $client->shouldReceive('fetchTotalGames')->andReturn(500);
        $client->shouldReceive('fetchItemStats')
            ->andReturnUsing(function () use (&$stats) { return [array_shift($stats)]; });

        $sync = new MetaTftSync($client);
        $sync->run(17);
        $sync->run(17);

        $row = ChampionItemBuild::query()
            ->where('champion_id', $champ->id)
            ->where('item_id', $item->id)
            ->first();

        $this->assertEqualsWithDelta(4.3, $row->avg_place, 0.001);
        $this->assertEqualsWithDelta(4.5, $row->prev_avg_place, 0.001);
        $this->assertEqualsWithDelta(-0.2, $row->place_change, 0.001);
    }

    public function test_sync_removes_items_missing_from_response(): void
    {
        $set = Set::factory()->create(['number' => 17]);
        $champ = Champion::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT17_Test',
            'is_playable' => true,
        ]);
        $a = Item::factory()->create(['set_id' => $set->id, 'api_name' => 'TFT_Item_A']);
        $b = Item::factory()->create(['set_id' => $set->id, 'api_name' => 'TFT_Item_B']);

        $run1 = [
            new ItemStatDto('TFT17_Test', 'TFT_Item_A', 4.2, 0.1, 0.5, 30, 0.1),
            new ItemStatDto('TFT17_Test', 'TFT_Item_B', 4.4, 0.1, 0.5, 30, 0.1),
        ];
        $run2 = [
            new ItemStatDto('TFT17_Test', 'TFT_Item_A', 4.1, 0.1, 0.5, 30, 0.1),
        ];
        $runs = [$run1, $run2];

        $client = Mockery::mock(MetaTftClient::class);
        $client->shouldReceive('fetchUnits')->andReturn([]);
        $client->shouldReceive('fetchTraits')->andReturn([]);
        $client->shouldReceive('fetchMetaComps')->andReturn([]);
        $client->shouldReceive('fetchAffinity')->andReturn([]);
        $client->shouldReceive('fetchCompanions')->andReturn([]);
        $client->shouldReceive('fetchItemBuilds')->andReturn([]);
        $client->shouldReceive('fetchTotalGames')->andReturn(500);
        $client->shouldReceive('fetchItemStats')
            ->andReturnUsing(function () use (&$runs) { return array_shift($runs); });

        $sync = new MetaTftSync($client);
        $sync->run(17);
        $sync->run(17);

        $this->assertDatabaseHas('champion_item_builds', [
            'champion_id' => $champ->id, 'item_id' => $a->id,
        ]);
        $this->assertDatabaseMissing('champion_item_builds', [
            'champion_id' => $champ->id, 'item_id' => $b->id,
        ]);
    }

    public function test_sync_stores_3_item_builds_with_sorted_names(): void
    {
        $set = Set::factory()->create(['number' => 17]);
        $champ = Champion::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT17_Test',
            'is_playable' => true,
        ]);

        $client = Mockery::mock(MetaTftClient::class);
        $client->shouldReceive('fetchUnits')->andReturn([]);
        $client->shouldReceive('fetchTraits')->andReturn([]);
        $client->shouldReceive('fetchMetaComps')->andReturn([]);
        $client->shouldReceive('fetchAffinity')->andReturn([]);
        $client->shouldReceive('fetchCompanions')->andReturn([]);
        $client->shouldReceive('fetchItemStats')->andReturn([]);
        $client->shouldReceive('fetchTotalGames')->andReturn(500);
        $client->shouldReceive('fetchItemBuilds')
            ->with('TFT17_Test')
            ->andReturn([
                new ItemBuildDto(
                    championApiName: 'TFT17_Test',
                    itemApiNames: ['TFT_Item_Z', 'TFT_Item_A', 'TFT_Item_M'],
                    avgPlace: 3.8,
                    winRate: 0.2,
                    top4Rate: 0.6,
                    games: 40,
                    frequency: 0.08,
                ),
            ]);

        (new MetaTftSync($client))->run(17);

        $row = \App\Models\ChampionItemSet::query()
            ->where('champion_id', $champ->id)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame(['TFT_Item_A', 'TFT_Item_M', 'TFT_Item_Z'], $row->item_api_names);
        $this->assertSame(3, $row->item_count);
        $this->assertSame('S', $row->tier);
        $this->assertEqualsWithDelta(0.08, $row->frequency, 0.001);
    }

    public function test_item_fetch_failure_increments_counter_and_keeps_old_rows(): void
    {
        $set = Set::factory()->create(['number' => 17]);
        $champ = Champion::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT17_Test',
            'is_playable' => true,
        ]);
        $item = Item::factory()->create(['set_id' => $set->id, 'api_name' => 'TFT_Item_A']);

        ChampionItemBuild::create([
            'champion_id' => $champ->id,
            'item_id' => $item->id,
            'set_id' => $set->id,
            'avg_place' => 4.2,
            'games' => 30,
            'frequency' => 0.1,
            'tier' => 'B',
            'synced_at' => now()->subDay(),
        ]);

        $client = Mockery::mock(MetaTftClient::class);
        $client->shouldReceive('fetchUnits')->andReturn([]);
        $client->shouldReceive('fetchTraits')->andReturn([]);
        $client->shouldReceive('fetchMetaComps')->andReturn([]);
        $client->shouldReceive('fetchAffinity')->andReturn([]);
        $client->shouldReceive('fetchCompanions')->andReturn([]);
        $client->shouldReceive('fetchItemBuilds')->andReturn([]);
        $client->shouldReceive('fetchTotalGames')->andReturn(0);
        $client->shouldReceive('fetchItemStats')
            ->andThrow(new \RuntimeException('HTTP 500'));

        $metaSync = (new MetaTftSync($client))->run(17);

        $this->assertGreaterThanOrEqual(1, $metaSync->failed_item_champions);
        $this->assertDatabaseHas('champion_item_builds', [
            'champion_id' => $champ->id,
            'item_id' => $item->id,
            'tier' => 'B',
        ]);
    }
}
