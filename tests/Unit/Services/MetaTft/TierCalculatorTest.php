<?php

namespace Tests\Unit\Services\MetaTft;

use App\Services\MetaTft\TierCalculator;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class TierCalculatorTest extends TestCase
{
    public function test_returns_null_when_games_below_gate(): void
    {
        $this->assertNull(TierCalculator::compute(3.2, 14));
    }

    public function test_returns_tier_at_games_gate(): void
    {
        $this->assertSame('SS', TierCalculator::compute(3.2, 15));
    }

    #[DataProvider('provide_tier_boundaries')]
    public function test_tier_boundaries(float $avg, string $expected): void
    {
        $this->assertSame($expected, TierCalculator::compute($avg, 100));
    }

    public static function provide_tier_boundaries(): array
    {
        return [
            'SS exact' => [3.5, 'SS'],
            'S just above SS' => [3.501, 'S'],
            'S exact' => [4.0, 'S'],
            'A just above S' => [4.001, 'A'],
            'A exact' => [4.3, 'A'],
            'B just above A' => [4.301, 'B'],
            'B exact' => [4.6, 'B'],
            'C just above B' => [4.601, 'C'],
            'C exact' => [5.0, 'C'],
            'D above C' => [5.001, 'D'],
            'D high' => [6.5, 'D'],
        ];
    }
}
