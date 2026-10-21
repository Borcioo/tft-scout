<?php

use App\Services\MetaTft\MetaTftClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

test('every endpoint is pinned to the resolved patch', function () {
    Http::fake(function (Request $request) {
        // Discovery call: no patch → the patches in the window
        if (! isset($request->data()['patch'])) {
            return Http::response(['games' => [
                ['patch' => '18.5', 'b_patch_version' => '', 'count' => 30_000],
                ['patch' => '18.4', 'b_patch_version' => 'b', 'count' => 6_000_000],
            ], 'results' => []]);
        }

        return Http::response(['results' => [
            ['unit' => 'DA_18_Ahri', 'places' => [1, 1, 1, 1, 1, 1, 1, 1]],
        ]]);
    });

    $client = app(MetaTftClient::class);
    $units = $client->fetchUnits(18);
    $client->fetchTraits(18);

    expect($units[0]->patch)->toBe('18.4b');

    $pinned = collect(Http::recorded())
        ->map(fn ($pair) => $pair[0]->data())
        ->filter(fn ($query) => isset($query['patch']));

    expect($pinned)->toHaveCount(2);
    foreach ($pinned as $query) {
        expect($query)->toMatchArray([
            'patch' => '18.4',
            'b_patch' => 'b',
            'days' => '2',
            'permit_filter_adjustment' => 'false',
        ]);
    }
});
