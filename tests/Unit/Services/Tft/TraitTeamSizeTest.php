<?php

namespace Tests\Unit\Services\Tft;

use App\Services\Tft\TraitTeamSize;
use Tests\TestCase;

class TraitTeamSizeTest extends TestCase
{
    public function test_set_17_mecha_grants_only_from_the_row_mentioning_team_size(): void
    {
        // Riot ships TeamSize=1 on every Mecha breakpoint; only the third
        // row ("+@TeamSize@ max team size") actually grants it.
        $desc = 'Innate: ... <row>(@MinUnits@) Energy Cells: @AP@%</row>'
            .'<row>(@MinUnits@) Overclocked Cells: @AP@%</row>'
            .'<row>(@MinUnits@) Precision Engineering: +@TeamSize@ max team size</row>';

        $this->assertSame([3 => 1], TraitTeamSize::byPosition($desc, [
            ['position' => 1, 'effects' => ['AP' => 25, 'TeamSize' => 1]],
            ['position' => 2, 'effects' => ['AP' => 40, 'TeamSize' => 1]],
            ['position' => 3, 'effects' => ['AP' => 40, 'TeamSize' => 1]],
        ]));
    }

    public function test_set_18_riftbeast_grants_two_at_ten(): void
    {
        $desc = '(@MinUnits@) Use the Alpha Mark (@MinUnits@) Every @OverrunCombats@ combats'
            .' (@MinUnits@) Riftbeasts grow (@MinUnits@) +@TeamSize@ maximum team size';

        $this->assertSame([4 => 2], TraitTeamSize::byPosition($desc, [
            ['position' => 1, 'effects' => []],
            ['position' => 2, 'effects' => []],
            ['position' => 3, 'effects' => []],
            ['position' => 4, 'effects' => ['TeamSize' => 2.0]],
        ]));
    }

    public function test_no_team_size_variable_means_no_bonus(): void
    {
        $this->assertSame([], TraitTeamSize::byPosition('(@MinUnits@) +@TeamSize@', [
            ['position' => 1, 'effects' => ['Health' => 175]],
        ]));
    }

    public function test_variable_without_a_description_row_is_trusted_as_is(): void
    {
        $this->assertSame([2 => 1], TraitTeamSize::byPosition('No rows here', [
            ['position' => 1, 'effects' => []],
            ['position' => 2, 'effects' => ['TeamSize' => 1]],
        ]));
    }
}
