<?php

namespace Database\Factories;

use App\Models\Champion;
use App\Models\Set;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Champion>
 */
class ChampionFactory extends Factory
{
    protected $model = Champion::class;

    public function definition(): array
    {
        return [
            'set_id' => Set::factory(),
            'api_name' => 'TFT17_Test'.fake()->unique()->numberBetween(1, 100000),
            'name' => fake()->firstName(),
            'cost' => 1,
            'slots_used' => 1,
            'is_playable' => true,
        ];
    }
}
