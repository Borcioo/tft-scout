<?php

namespace App\Http\Controllers;

use App\Models\Plan;
use App\Services\Scout\ScoutContextBuilder;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

class RandomController extends Controller
{
    public function __construct(
        private readonly ScoutContextBuilder $builder,
    ) {}

    public function index(): Response
    {
        $setNumber = (int) config('services.tft.set', 17);
        $itemBuilds = $this->builder->buildItemBuildsForInertia($setNumber);

        $savedPlannerCodes = Auth::check()
            ? Plan::forUser((int) Auth::id())
                ->whereNotNull('planner_code')
                ->pluck('planner_code')
                ->values()
            : [];

        return Inertia::render('Random/Index', [
            'setNumber' => $setNumber,
            'itemBuilds' => $itemBuilds,
            'savedPlannerCodes' => $savedPlannerCodes,
        ]);
    }
}
