<?php

namespace App\Http\Controllers;

use App\Models\Champion;
use App\Models\Plan;
use App\Models\Set;
use App\Services\Scout\ScoutContextBuilder;
use App\Support\PlannerCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

/**
 * User-saved team plans from the Scout flow.
 *
 * MVP: user clicks "Save" on a scout comp card → we store champion
 * apiNames as slots (no positions/items yet — just the composition).
 * Plans/Index renders the list. Delete per-row.
 */
class PlansController extends Controller
{
    public function __construct(
        private readonly ScoutContextBuilder $builder,
    ) {}

    public function index(): Response
    {
        $userId = (int) Auth::id();
        $setNumber = (int) config('services.tft.set', 17);

        $plans = Plan::forUser($userId)
            ->orderByDesc('updated_at')
            ->get(['id', 'name', 'notes', 'slots', 'planner_code', 'meta', 'set_id', 'updated_at'])
            ->map(fn (Plan $p) => [
                'id' => $p->id,
                'name' => $p->name,
                'notes' => $p->notes,
                'slots' => $p->slots,
                'plannerCode' => $p->planner_code,
                'meta' => $p->meta,
                'updatedAt' => $p->updated_at?->toIso8601String(),
            ])
            ->values();

        // Lightweight lookup: apiName → {name, cost, icon, plannerCode,
        // baseApiName} for every champion referenced by the user's plans.
        // Provides enough data for CompCardBody to render champ chips and
        // the item-builds accordion without hitting the scout-context
        // endpoint.
        $apiNames = $plans->pluck('slots')
            ->flatten(1)
            ->pluck('champion_api_name')
            ->filter()
            ->unique()
            ->values();

        $championLookup = Champion::query()
            ->whereIn('api_name', $apiNames)
            ->with('baseChampion:id,api_name')
            ->get(['id', 'api_name', 'name', 'cost', 'planner_code', 'base_champion_id', 'variant_label'])
            ->mapWithKeys(fn (Champion $c) => [
                $c->api_name => [
                    'apiName' => $c->api_name,
                    'name' => $c->name,
                    'cost' => $c->cost,
                    'icon' => '/icons/champions/'.$c->api_name.'.png',
                    'plannerCode' => $c->planner_code,
                    'baseApiName' => $c->baseChampion?->api_name,
                    'variant' => $c->variant_label,
                ],
            ]);

        // Filter dropdowns show only traits that actually appear across
        // the user's saved plans — no point offering Anima Squad as a
        // filter option if no saved comp uses it. Pulled from meta
        // snapshot (activeTraits) rather than computed.
        $traitFilter = $plans
            ->pluck('meta.activeTraits')
            ->filter()
            ->flatten(1)
            ->unique('apiName')
            ->map(fn ($t) => [
                'apiName' => $t['apiName'] ?? null,
                'name' => $t['name'] ?? '',
                'icon' => $t['icon'] ?? null,
            ])
            ->filter(fn ($t) => $t['apiName'] !== null)
            ->sortBy('name')
            ->values();

        // Same accordion data used on Scout page — mirrors ScoutController.
        $itemBuilds = $this->builder->buildItemBuildsForInertia($setNumber);

        return Inertia::render('Plans/Index', [
            'plans' => $plans,
            'championLookup' => $championLookup,
            'traitFilter' => $traitFilter,
            'itemBuilds' => $itemBuilds,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:150'],
            'notes' => ['nullable', 'string'],
            'champions' => ['required', 'array', 'min:1', 'max:10'],
            'champions.*' => ['string', 'max:100'],
            // Meta is a trusted snapshot — we don't validate its inner shape.
            // It's only ever read back to render UI, never used in decisions.
            'meta' => ['nullable', 'array'],
        ]);

        $set = Set::query()->active()->first() ?? Set::query()->orderByDesc('number')->firstOrFail();

        // Resolve planner codes from DB — single source of truth (frontend
        // may send stale/unknown apiNames, this guarantees correctness).
        $championRows = Champion::query()
            ->whereIn('api_name', $data['champions'])
            ->get(['api_name', 'planner_code'])
            ->keyBy('api_name');

        $enriched = array_map(
            fn (string $api) => [
                'apiName' => $api,
                'plannerCode' => $championRows->get($api)?->planner_code,
            ],
            $data['champions'],
        );

        $plannerCode = PlannerCode::generate($enriched);

        // Idempotent: if this user already saved this exact comp, return the
        // existing row (200) instead of creating a duplicate. Frontend treats
        // both 200 and 201 as success — 200 means "already saved".
        if ($plannerCode !== null) {
            $existing = Plan::forUser((int) Auth::id())
                ->where('planner_code', $plannerCode)
                ->first();

            if ($existing) {
                return response()->json([
                    'id' => $existing->id,
                    'name' => $existing->name,
                    'plannerCode' => $existing->planner_code,
                    'alreadySaved' => true,
                ], 200);
            }
        }

        // MVP slot shape: positions/items empty, filled later via planner UI.
        $slots = array_map(
            fn (string $apiName) => [
                'x' => 0,
                'y' => 0,
                'champion_api_name' => $apiName,
                'star_level' => 1,
                'items' => [],
            ],
            $data['champions'],
        );

        $plan = Plan::create([
            'user_id' => Auth::id(),
            'set_id' => $set->id,
            'name' => $data['name'],
            'notes' => $data['notes'] ?? null,
            'slots' => $slots,
            'planner_code' => $plannerCode,
            'meta' => $data['meta'] ?? null,
        ]);

        return response()->json([
            'id' => $plan->id,
            'name' => $plan->name,
            'plannerCode' => $plan->planner_code,
            'alreadySaved' => false,
        ], 201);
    }

    public function destroy(Plan $plan): JsonResponse
    {
        abort_unless($plan->user_id === Auth::id(), 403);

        $plan->delete();

        return response()->json(['ok' => true]);
    }
}
