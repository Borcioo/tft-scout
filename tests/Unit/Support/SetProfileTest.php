<?php

use App\Support\SetProfile;

test('unconfigured set falls back to the TFT prefix and evergreen items', function () {
    $profile = SetProfile::for(42);

    expect($profile->prefixes)->toBe(['TFT42_'])
        ->and($profile->evergreenItems)->toBeTrue()
        ->and($profile->owns('TFT42_Jinx'))->toBeTrue()
        ->and($profile->owns('TFT17_Jinx'))->toBeFalse();
});

test('set 18 owns namespaced ids', function () {
    $profile = SetProfile::for(18);

    expect($profile->evergreenItems)->toBeFalse()
        ->and($profile->owns('DA_18_Ahri'))->toBeTrue()
        ->and($profile->owns('DA_Amumu18'))->toBeTrue()
        ->and($profile->owns('DA_InfinityEdge'))->toBeTrue()
        ->and($profile->owns('TFT_Item_InfinityEdge'))->toBeFalse()
        ->and($profile->owns('TFT9_SLIME_Crab'))->toBeFalse()
        ->and($profile->slotsByTrait)->toBe(['DA_18_ApexPredator' => 2]);
});

test('canonical unit folds adaptor forms', function (string $metatftId, string $expected) {
    $known = [
        'DA_18_MasterYi_AD' => true,
        'DA_Gromp18_AP' => true,
        'DA_Nidalee18_AP' => true,
        'DA_18_Ahri' => true,
    ];

    expect(SetProfile::for(18)->canonicalUnit($metatftId, $known))->toBe($expected);
})->with([
    '_AD/_AP sibling' => ['DA_18_MasterYi_AP', 'DA_18_MasterYi_AD'],
    'reverse sibling' => ['DA_Gromp18_AD', 'DA_Gromp18_AP'],
    'config alias' => ['DA_NidaleeCougar18_AD', 'DA_Nidalee18_AP'],
    'known id' => ['DA_18_Ahri', 'DA_18_Ahri'],
    'unknown id' => ['TFT18_SprykinSummonMelee', 'TFT18_SprykinSummonMelee'],
]);
