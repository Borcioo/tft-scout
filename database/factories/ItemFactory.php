<?php

namespace Database\Factories;

use App\Models\Item;
use App\Models\Set;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Item>
 */
class ItemFactory extends Factory
{
    protected $model = Item::class;

    public function definition(): array
    {
        return [
            'set_id' => Set::factory(),
            'api_name' => 'TFT_Item_Test'.fake()->unique()->numberBetween(1, 100000),
            'name' => fake()->word(),
            'type' => 'base',
        ];
    }
}
