<?php

namespace App\Http\Controllers;

use App\Models\Plan;
use App\Services\Scout\ScoutContextBuilder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response as HttpResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\Process\ExecutableFinder;

class ScoutController extends Controller
{
    public function __construct(
        private readonly ScoutContextBuilder $builder,
    ) {}

    /**
     * Renders the /scout page. The page spawns a Web Worker on mount
     * which calls `/api/scout/context` for the full data payload — we
     * don't pass it as an Inertia prop to keep the initial HTML
     * response under 50 KB.
     */
    public function index(): Response
    {
        $setNumber = (int) config('services.tft.set', 18);

        // Prefetch top 3-item builds per champion directly in Inertia
        // props — UI accordion can render without a separate fetch.
        $itemBuilds = $this->builder->buildItemBuildsForInertia($setNumber);

        // For authed users: pass down already-saved planner codes so the
        // Scout cards can highlight comps the user has already saved and
        // prevent duplicate saves.
        $savedPlannerCodes = Auth::check()
            ? Plan::forUser((int) Auth::id())
                ->whereNotNull('planner_code')
                ->pluck('planner_code')
                ->values()
            : [];

        return Inertia::render('Scout/Index', [
            'setNumber' => $setNumber,
            'itemBuilds' => $itemBuilds,
            'savedPlannerCodes' => $savedPlannerCodes,
        ]);
    }

    /**
     * The scout Web Worker fetches this endpoint once on init. Staleness
     * is now handled globally by RevalidateMetaTft middleware (runs on
     * every web request in terminate(), lock-guarded) — we still return
     * `stale: true` in the payload so the worker / UI can surface a
     * banner, but the middleware owns the dispatch side.
     */
    public function context(): JsonResponse
    {
        $setNumber = (int) config('services.tft.set', 18);
        $context = $this->builder->build($setNumber);

        return response()->json($context);
    }

    /**
     * Accepts a generate run captured in the UI and pipes it to the
     * scout-lab sidecar via `scout-cli lab ingest` on stdin so it
     * lands in tmp/scout-lab/runs.db next to experiment runs.
     *
     * Gated on SCOUT_LAB_ENABLED (config services.scout_lab.enabled) —
     * when off the endpoint returns 204 immediately without touching
     * the pipeline, so the frontend can fire-and-forget regardless of
     * config and the call is a no-op in normal deployments.
     *
     * Runs node + the local tsx CLI directly instead of `npx`: web
     * servers hand Symfony Process an environment without PATH (PHP's
     * $_SERVER lacks it under php -S / php-cgi), so `npx` was not found
     * and every ingest failed with exit 127.
     */
    public function labIngest(Request $request): HttpResponse
    {
        if (! config('services.scout_lab.enabled')) {
            return response()->noContent();
        }

        $payload = $request->getContent();

        if ($payload === '') {
            return response('empty body', 400);
        }

        $node = config('services.scout_lab.node') ?: (new ExecutableFinder)->find('node');

        if (! $node) {
            Log::warning('scout lab ingest failed', [
                'error' => 'node not found on PATH; set SCOUT_LAB_NODE',
            ]);

            return response('ingest failed', 500);
        }

        $result = Process::path(base_path())
            ->env([
                'SCOUT_LAB_ENABLED' => '1',
                'PATH' => (string) getenv('PATH'),
            ])
            ->input($payload)
            ->timeout(10)
            ->run([
                $node,
                base_path('node_modules/tsx/dist/cli.mjs'),
                'scripts/scout-cli.ts',
                'lab',
                'ingest',
            ]);

        if ($result->failed()) {
            Log::warning('scout lab ingest failed', [
                'exit' => $result->exitCode(),
                'error' => trim($result->errorOutput()),
            ]);

            return response('ingest failed', 500);
        }

        return response()->noContent();
    }
}
