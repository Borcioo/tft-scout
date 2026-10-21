<?php

use App\Services\MetaTft\MetaTftClient;

$games = [
    ['patch' => '18.5', 'b_patch_version' => '', 'count' => 30_427],
    ['patch' => '18.4', 'b_patch_version' => 'b', 'count' => 6_139_686],
];

test('a fresh patch with few games falls back to the previous one', function () use ($games) {
    expect(MetaTftClient::pickPatch($games, 300_000))
        ->toBe(['patch' => '18.4', 'b_patch' => 'b', 'games' => 6_139_686, 'label' => '18.4b']);
});

test('the newest patch wins once it has enough games', function () use ($games) {
    expect(MetaTftClient::pickPatch($games, 20_000)['label'])->toBe('18.5');
});

test('b patches sort after their base patch', function () {
    $picked = MetaTftClient::pickPatch([
        ['patch' => '18.4', 'b_patch_version' => '', 'count' => 900_000],
        ['patch' => '18.4', 'b_patch_version' => 'b', 'count' => 800_000],
    ], 300_000);

    expect($picked['label'])->toBe('18.4b');
});

test('with no patch over the bar the biggest sample is used', function () {
    $picked = MetaTftClient::pickPatch([
        ['patch' => '18.5', 'b_patch_version' => '', 'count' => 9_000],
        ['patch' => '18.4', 'b_patch_version' => 'b', 'count' => 40_000],
    ], 300_000);

    expect($picked['label'])->toBe('18.4b');
});

test('an empty list keeps the API default', function () {
    expect(MetaTftClient::pickPatch([], 300_000)['patch'])->toBe('current');
});
