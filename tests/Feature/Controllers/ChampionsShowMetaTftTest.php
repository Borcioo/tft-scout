<?php

namespace Tests\Feature\Controllers;

use App\Models\Champion;
use App\Models\ChampionItemBuild;
use App\Models\ChampionItemSet;
use App\Models\Item;
use App\Models\Set;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class ChampionsShowMetaTftTest extends TestCase
{
    use RefreshDatabase;

    public function test_show_includes_metatft_items_single_and_builds(): void
    {
        $set = Set::factory()->create(['number' => 17]);
        $champ = Champion::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT17_Aatrox',
        ]);
        $item = Item::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT_Item_GuinsoosRageblade',
            'name' => "Guinsoo's Rageblade",
            'icon_path' => 'icons/items/guinsoos.png',
        ]);

        ChampionItemBuild::create([
            'champion_id' => $champ->id,
            'item_id' => $item->id,
            'set_id' => $set->id,
            'avg_place' => 3.9,
            'games' => 200,
            'frequency' => 0.2,
            'win_rate' => 0.22,
            'top4_rate' => 0.6,
            'tier' => 'S',
            'place_change' => -0.3,
            'synced_at' => now(),
        ]);

        ChampionItemSet::create([
            'champion_id' => $champ->id,
            'set_id' => $set->id,
            'item_api_names' => ['TFT_Item_GuinsoosRageblade'],
            'avg_place' => 3.9,
            'games' => 200,
            'frequency' => 0.2,
            'win_rate' => 0.22,
            'top4_rate' => 0.6,
            'item_count' => 1,
            'tier' => 'S',
            'synced_at' => now(),
        ]);

        $this->get('/champions/TFT17_Aatrox')
            ->assertInertia(fn (Assert $page) => $page
                ->component('Champions/Show')
                ->has('metatft.items_single', 1, fn (Assert $row) => $row
                    ->where('api_name', 'TFT_Item_GuinsoosRageblade')
                    ->where('name', "Guinsoo's Rageblade")
                    ->where('tier', 'S')
                    ->where('avg_place', 3.9)
                    ->where('place_change', -0.3)
                    ->etc(),
                )
                ->has('metatft.items_builds', 1)
                ->has('metatft.synced_at')
            );
    }

    public function test_show_returns_empty_arrays_when_no_metatft_data(): void
    {
        $set = Set::factory()->create(['number' => 17]);
        Champion::factory()->create([
            'set_id' => $set->id,
            'api_name' => 'TFT17_Empty',
        ]);

        $this->get('/champions/TFT17_Empty')
            ->assertInertia(fn (Assert $page) => $page
                ->where('metatft.items_single', [])
                ->where('metatft.items_builds', [])
                ->where('metatft.synced_at', null)
            );
    }
}
