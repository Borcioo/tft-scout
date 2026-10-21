<?php

use App\Models\Set;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;

uses(RefreshDatabase::class);

function postLabIngest(string $body = '{"params":{},"results":[]}')
{
    return test()->call('POST', '/api/scout/lab/ingest', [], [], [], ['CONTENT_TYPE' => 'application/json'], $body);
}

test('is a no-op while the lab is disabled', function () {
    config(['services.scout_lab.enabled' => false]);
    Process::fake();

    postLabIngest()->assertNoContent();

    Process::assertNothingRan();
});

test('pipes the run to the lab CLI through node, not npx', function () {
    config(['services.scout_lab.enabled' => true, 'services.scout_lab.node' => '/opt/node/bin/node']);
    Process::fake();

    postLabIngest('{"params":{"level":8},"results":[]}')->assertNoContent();

    Process::assertRan(fn (PendingProcess $process) => $process->command === [
        '/opt/node/bin/node',
        base_path('node_modules/tsx/dist/cli.mjs'),
        'scripts/scout-cli.ts',
        'lab',
        'ingest',
    ]
        && $process->path === base_path()
        && $process->input === '{"params":{"level":8},"results":[]}'
        // Web servers hand child processes no PATH; it has to be explicit
        && $process->environment['PATH'] === (string) getenv('PATH')
        && $process->environment['SCOUT_LAB_ENABLED'] === '1');
});

test('reports a failing CLI as 500', function () {
    config(['services.scout_lab.enabled' => true, 'services.scout_lab.node' => 'node']);
    Process::fake(fn () => Process::result(errorOutput: 'no such table: runs', exitCode: 1));

    postLabIngest()->assertStatus(500);
});

test('rejects an empty body', function () {
    config(['services.scout_lab.enabled' => true]);
    Process::fake();

    postLabIngest('')->assertStatus(400);

    Process::assertNothingRan();
});

test('shares the lab flag with the frontend', function () {
    config(['services.scout_lab.enabled' => true]);

    Set::factory()->create(['number' => 18]);
    config(['services.tft.set' => 18]);

    $this->get('/scout')->assertInertia(fn ($page) => $page->where('scoutLabEnabled', true));
});
