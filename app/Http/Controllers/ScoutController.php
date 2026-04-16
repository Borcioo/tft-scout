<?php

namespace App\Http\Controllers;

use App\Jobs\RefreshMetaTftJob;
use App\Services\Scout\ScoutContextBuilder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response as HttpResponse;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\Process\Exception\ProcessFailedException;
use Symfony\Component\Process\Process;

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
        $setNumber = (int) config('services.tft.set', 17);

        // Prefetch top 3-item builds per champion directly in Inertia
        // props — UI accordion can render without a separate fetch.
        $itemBuilds = $this->builder->buildItemBuildsForInertia($setNumber);

        return Inertia::render('Scout/Index', [
            'setNumber' => $setNumber,
            'itemBuilds' => $itemBuilds,
        ]);
    }

    /**
     * The scout Web Worker fetches this endpoint once on init. If the
     * latest successful sync is >24h old, dispatch a background refresh
     * job (stale-while-revalidate) and return the current data anyway
     * with `stale: true`.
     */
    public function context(): JsonResponse
    {
        $setNumber = (int) config('services.tft.set', 17);
        $context = $this->builder->build($setNumber);

        if ($context['stale']) {
            RefreshMetaTftJob::dispatch($setNumber);
        }

        return response()->json($context);
    }

    /**
     * Accepts a generate run captured in the UI and pipes it to the
     * scout-lab sidecar via `scout-cli lab ingest` on stdin so it
     * lands in tmp/scout-lab/runs.db next to experiment runs.
     *
     * Gated on the SCOUT_LAB_ENABLED env var — when it's not "1" the
     * endpoint returns 204 immediately without touching the pipeline,
     * so the frontend can fire-and-forget regardless of config and
     * the call is a no-op in normal deployments.
     */
    public function labIngest(Request $request): HttpResponse
    {
        if (env('SCOUT_LAB_ENABLED') !== '1') {
            return response()->noContent();
        }

        $payload = $request->getContent();

        if ($payload === '' || $payload === false) {
            return response('empty body', 400);
        }

        try {
            $process = new Process(
                ['npx', 'tsx', 'scripts/scout-cli.ts', 'lab', 'ingest'],
                base_path(),
                ['SCOUT_LAB_ENABLED' => '1'] + $_ENV,
                $payload,
                10.0,
            );
            $process->run();

            if (! $process->isSuccessful()) {
                throw new ProcessFailedException($process);
            }
        } catch (\Throwable $e) {
            Log::warning('scout lab ingest failed', [
                'error' => $e->getMessage(),
            ]);

            return response('ingest failed', 500);
        }

        return response()->noContent();
    }
}
