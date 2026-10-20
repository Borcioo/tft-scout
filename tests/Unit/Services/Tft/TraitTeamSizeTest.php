<?php

use App\Services\Tft\TraitTeamSize;

test('set 17 mecha grants only from the row mentioning team size', function () {
    // Riot ships TeamSize=1 on every Mecha breakpoint; only the third
    // row ("+@TeamSize@ max team size") actually grants it.
    $desc = 'Innate: ... <row>(@MinUnits@) Energy Cells: @AP@%</row>'
        .'<row>(@MinUnits@) Overclocked Cells: @AP@%</row>'
        .'<row>(@MinUnits@) Precision Engineering: +@TeamSize@ max team size</row>';

    expect(TraitTeamSize::byPosition($desc, [
        ['position' => 1, 'effects' => ['AP' => 25, 'TeamSize' => 1]],
        ['position' => 2, 'effects' => ['AP' => 40, 'TeamSize' => 1]],
        ['position' => 3, 'effects' => ['AP' => 40, 'TeamSize' => 1]],
    ]))->toBe([3 => 1]);
});

test('set 18 riftbeast grants two at ten', function () {
    $desc = '(@MinUnits@) Use the Alpha Mark (@MinUnits@) Every @OverrunCombats@ combats'
        .' (@MinUnits@) Riftbeasts grow (@MinUnits@) +@TeamSize@ maximum team size';

    expect(TraitTeamSize::byPosition($desc, [
        ['position' => 1, 'effects' => []],
        ['position' => 2, 'effects' => []],
        ['position' => 3, 'effects' => []],
        ['position' => 4, 'effects' => ['TeamSize' => 2.0]],
    ]))->toBe([4 => 2]);
});

test('no team size variable means no bonus', function () {
    expect(TraitTeamSize::byPosition('(@MinUnits@) +@TeamSize@', [
        ['position' => 1, 'effects' => ['Health' => 175]],
    ]))->toBe([]);
});

test('variable without a description row is trusted as is', function () {
    expect(TraitTeamSize::byPosition('No rows here', [
        ['position' => 1, 'effects' => []],
        ['position' => 2, 'effects' => ['TeamSize' => 1]],
    ]))->toBe([2 => 1]);
});
