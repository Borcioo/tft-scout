<?php

namespace App\Http\Controllers;

use App\Jobs\RefreshMetaTftJob;
use App\Services\Scout\ScoutContextBuilder;
use Illuminate\Http\JsonResponse;
use Inertia\Inertia;
use Inertia\Response;

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
        return Inertia::render('Scout/Index', [
            'setNumber' => 17,
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
        $setNumber = 17;
        $context = $this->builder->build($setNumber);

        if ($context['stale']) {
            RefreshMetaTftJob::dispatch($setNumber);
        }

        return response()->json($context);
    }
}
