<?php

namespace Tests\Feature\Services\MetaTft;

use App\Models\Champion;
use App\Models\ChampionItemBuild;
use App\Models\Item;
use App\Models\Set;
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
}
