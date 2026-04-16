<?php

namespace Database\Factories;

use App\Models\Set;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Set>
 */
class SetFactory extends Factory
{
    protected $model = Set::class;

    public function definition(): array
    {
        return [
            'number' => 17,
            'name' => 'Test Set',
            'is_active' => true,
        ];
    }
}
