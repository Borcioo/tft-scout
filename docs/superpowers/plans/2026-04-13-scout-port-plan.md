# Scout Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the legacy TFT Scout algorithm to the new Laravel + Inertia + React app. Algorithm runs in a browser Web Worker (never on the backend). Backend serves a `/api/scout/context` payload and handles MetaTFT data sync.

**Architecture:** Three slices — (1) MetaTFT sync pipeline writing to existing `champion_ratings` / `trait_ratings` / `champion_trait_affinity` / `champion_companions` / `meta_comps` tables; (2) `ScoutController@context` that joins those tables into the JSON shape the worker expects; (3) Web Worker + hook + `/scout` page that ports legacy client files nearly 1:1 from `legacy/tft-generator/client/src/`.

**Tech Stack:** Laravel 13, PHP 8.4, Postgres 18, Inertia 2, React 19, TypeScript 5, Vite, Tailwind + shadcn/ui, Laravel Queue (DB driver), Web Workers (module type).

**Reference spec:** `docs/superpowers/specs/2026-04-13-scout-port-design.md`

---

## File structure (locked in up front)

### Backend (new files)

```
app/Services/MetaTft/
  ├── MetaTftClient.php          — HTTP client (base URL, rate limit, retry)
  ├── MetaTftSync.php            — orchestrator: fetch → aggregate → upsert
  └── Dto/
      ├── UnitRatingDto.php
      ├── TraitRatingDto.php
      ├── AffinityDto.php
      ├── CompanionDto.php
      └── MetaCompDto.php

app/Services/Scout/
  └── ScoutContextBuilder.php    — joins DB → JSON payload for worker

app/Http/Controllers/
  └── ScoutController.php        — index() renders /scout page, context() returns JSON

app/Console/Commands/
  └── MetaTftSync.php            — `php artisan metatft:sync [--set=17]`

app/Jobs/
  └── RefreshMetaTftJob.php      — queued stale-while-revalidate job

database/migrations/
  └── 2026_04_13_150000_create_meta_syncs_table.php

tests/Feature/
  └── ScoutContextTest.php       — integration test for context shape
```

### Frontend (new files)

```
resources/js/workers/scout/
  ├── index.ts               — worker entry (port of scout.worker.js)
  ├── engine.ts              — port of algorithm/engine.js (129L)
  ├── synergy-graph.ts       — port of algorithm/synergy-graph.js (903L)
  ├── scorer.ts              — port of algorithm/scorer.js (388L)
  ├── config.ts              — port of algorithm/config.js (65L)
  ├── candidates.ts          — port of algorithm/candidates.js (83L)
  ├── active-traits.ts       — port of algorithm/active-traits.js (64L)
  ├── re-score.ts            — port of algorithm/re-score.js (40L)
  ├── insights.ts            — port of algorithm/insights.js (150L)
  └── types.ts               — TS types for worker boundary

resources/js/hooks/
  └── use-scout-worker.ts    — port of hooks/useScoutWorker.js

resources/js/pages/Scout/
  └── Index.tsx              — main scout page

resources/js/components/scout/
  ├── ScoutControls.tsx           — level, topN, max5Cost, roleBalance
  ├── LockedChampionsPicker.tsx   — multi-select champions
  ├── LockedTraitsPicker.tsx      — multi-select traits + breakpoint
  ├── EmblemPicker.tsx            — trait → emblem count
  ├── ScoutResultsList.tsx        — grid of comp cards
  └── ScoutCompCard.tsx           — single comp card
```

### Files to modify

- `routes/web.php` — add `/scout` and `/api/scout/context` routes
- `resources/js/app/nav.tsx` (or equivalent) — add Scout link to sidebar/nav

---

## Phase A — MetaTFT sync backend

Goal of this phase: after completion, `php artisan metatft:sync --set=17` runs end-to-end, populates `champion_ratings` / `trait_ratings` / `champion_trait_affinity` / `champion_companions` / `meta_comps`, and stamps `meta_syncs` with `status=ok`.

### Task A1: Pre-work — extract MetaTFT endpoints from legacy

**Files:**
- Read-only: `legacy/tft-generator/server/src/services/ratings.service.js`
- Read-only: any `legacy/**/*.js` that contains `BASE_URL`, `metatft.gg`, or `explorer/`

- [ ] **Step 1: Search legacy for MetaTFT endpoint URLs**

Run:
```bash
grep -rn "metatft\|explorer/\|BASE_URL" legacy/tft-generator/server/src/ legacy/tft-generator/client/src/ 2>/dev/null
```

Expected: list of `metatftCache.fetch('units' | 'traits' | 'explorer/traits' | 'explorer/units' | 'unit_items' | ...)` call sites plus the base URL constant.

- [ ] **Step 2: Record discovered endpoints**

Write findings to `docs/superpowers/plans/metatft-api-notes.md` with:
- Base URL (something like `https://api.metatft.com/public/v1/`)
- List of endpoints used (`units`, `traits`, `explorer/traits`, `explorer/units`, `unit_items`)
- Query param shapes per endpoint (from the `fetch(endpoint, params)` callers)
- Known auth/rate-limit rules (check for headers, tokens, `rateLimiter` usage)

- [ ] **Step 3: Commit notes**

```bash
git add docs/superpowers/plans/metatft-api-notes.md
git commit -m "docs: capture legacy MetaTFT endpoint catalogue for scout port"
```

---

### Task A2: `meta_syncs` table migration + model

**Files:**
- Create: `database/migrations/2026_04_13_150000_create_meta_syncs_table.php`
- Create: `app/Models/MetaSync.php`

- [ ] **Step 1: Write migration**

Create `database/migrations/2026_04_13_150000_create_meta_syncs_table.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('meta_syncs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('set_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('synced_at')->useCurrent();
            $table->integer('units_count')->default(0);
            $table->integer('traits_count')->default(0);
            $table->integer('affinity_count')->default(0);
            $table->integer('companions_count')->default(0);
            $table->integer('meta_comps_count')->default(0);
            $table->string('status', 20)->default('ok'); // ok | partial | failed
            $table->text('notes')->nullable();

            $table->index(['set_id', 'synced_at']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('meta_syncs');
    }
};
```

- [ ] **Step 2: Write the Eloquent model**

Create `app/Models/MetaSync.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single MetaTFT sync run — one row per `metatft:sync` invocation,
 * records how many rows were upserted per category and whether the
 * run succeeded. ScoutContextBuilder reads the most recent `ok` row to
 * decide whether data is stale (>24h) and a background refresh should
 * be kicked off.
 */
class MetaSync extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'set_id',
        'synced_at',
        'units_count',
        'traits_count',
        'affinity_count',
        'companions_count',
        'meta_comps_count',
        'status',
        'notes',
    ];

    protected $casts = [
        'synced_at' => 'datetime',
        'units_count' => 'integer',
        'traits_count' => 'integer',
        'affinity_count' => 'integer',
        'companions_count' => 'integer',
        'meta_comps_count' => 'integer',
    ];

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }
}
```

- [ ] **Step 3: Run migration**

Run:
```bash
php artisan migrate
```

Expected output: `2026_04_13_150000_create_meta_syncs_table ... DONE`

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026_04_13_150000_create_meta_syncs_table.php app/Models/MetaSync.php
git commit -m "feat(scout): add meta_syncs table for metatft sync tracking"
```

---

### Task A3: MetaTFT DTOs

**Files:**
- Create: `app/Services/MetaTft/Dto/UnitRatingDto.php`
- Create: `app/Services/MetaTft/Dto/TraitRatingDto.php`
- Create: `app/Services/MetaTft/Dto/AffinityDto.php`
- Create: `app/Services/MetaTft/Dto/CompanionDto.php`
- Create: `app/Services/MetaTft/Dto/MetaCompDto.php`

DTOs are immutable value objects that sit between `MetaTftClient` (raw JSON) and `MetaTftSync` (database upserts). Keeps the shape changes in one place when MetaTFT renames a field.

- [ ] **Step 1: Create UnitRatingDto**

Create `app/Services/MetaTft/Dto/UnitRatingDto.php`:

```php
<?php

namespace App\Services\MetaTft\Dto;

/**
 * One champion's aggregate performance across MetaTFT's sample games.
 * `apiName` is the CDragon identifier (TFT17_Aatrox) — matches our
 * champions.api_name column so MetaTftSync can FK-link via a single
 * lookup map.
 *
 * Score is derived the same way the legacy scout did: `(6 - avg_place) / 3`
 * clamped to [0, 1]. Avg 1 = 1.66 → clamped 1.0; avg 6 = 0. Lets the
 * algorithm use `score` directly as a 0-1 weight without reaching for
 * avg_place each time.
 */
final readonly class UnitRatingDto
{
    public function __construct(
        public string $apiName,
        public float $avgPlace,
        public float $winRate,
        public float $top4Rate,
        public int $games,
        public ?string $patch,
    ) {}

    public function score(): float
    {
        $raw = (6.0 - $this->avgPlace) / 3.0;

        return max(0.0, min(1.0, $raw));
    }
}
```

- [ ] **Step 2: Create TraitRatingDto**

Create `app/Services/MetaTft/Dto/TraitRatingDto.php`:

```php
<?php

namespace App\Services\MetaTft\Dto;

/**
 * One trait-at-breakpoint aggregate. `breakpointPosition` is 1-based
 * within the trait's breakpoint list (1 = Bronze/first tier, 2 =
 * Silver, etc.) — same convention as `trait_breakpoints.position`.
 */
final readonly class TraitRatingDto
{
    public function __construct(
        public string $traitApiName,
        public int $breakpointPosition,
        public float $avgPlace,
        public float $winRate,
        public float $top4Rate,
        public int $games,
    ) {}

    public function score(): float
    {
        $raw = (6.0 - $this->avgPlace) / 3.0;

        return max(0.0, min(1.0, $raw));
    }
}
```

- [ ] **Step 3: Create AffinityDto**

Create `app/Services/MetaTft/Dto/AffinityDto.php`:

```php
<?php

namespace App\Services\MetaTft\Dto;

/**
 * A champion's affinity for a specific trait at a specific breakpoint.
 * "Affinity" here = how well this champion performs when that trait is
 * active at that breakpoint. Populated from the MetaTFT explorer API
 * per champion. Legacy scout uses top 3 affinity matches per champion,
 * capped, to avoid diversity bias.
 */
final readonly class AffinityDto
{
    public function __construct(
        public string $championApiName,
        public string $traitApiName,
        public int $breakpointPosition,
        public float $avgPlace,
        public int $games,
        public float $frequency,
    ) {}
}
```

- [ ] **Step 4: Create CompanionDto**

Create `app/Services/MetaTft/Dto/CompanionDto.php`:

```php
<?php

namespace App\Services\MetaTft\Dto;

/**
 * Champion-pair co-occurrence in real games. Both champions played on
 * the same board → affinityScore derived from avg_place. Legacy scout
 * uses these for phase 5 (companion-seeded) and as "hidden edges" in
 * the synergy graph that don't require shared traits.
 */
final readonly class CompanionDto
{
    public function __construct(
        public string $championApiName,
        public string $companionApiName,
        public float $avgPlace,
        public int $games,
        public float $frequency,
    ) {}
}
```

- [ ] **Step 5: Create MetaCompDto**

Create `app/Services/MetaTft/Dto/MetaCompDto.php`:

```php
<?php

namespace App\Services\MetaTft\Dto;

/**
 * A known meta composition — list of champions + their aggregate
 * performance. Legacy scout phase 6 seeds from these. The `champions`
 * array holds CDragon api_names so the consumer can FK-link via a
 * single lookup map. `id` is the MetaTFT-provided stable identifier.
 */
final readonly class MetaCompDto
{
    /**
     * @param  list<string>  $championApiNames
     * @param  list<string>  $traitApiNames
     */
    public function __construct(
        public string $id,
        public string $name,
        public array $championApiNames,
        public array $traitApiNames,
        public float $avgPlace,
        public int $games,
        public int $level,
    ) {}
}
```

- [ ] **Step 6: Commit**

```bash
git add app/Services/MetaTft/Dto/
git commit -m "feat(scout): add MetaTFT DTOs for sync payloads"
```

---

### Task A4: `MetaTftClient` HTTP wrapper

**Files:**
- Create: `app/Services/MetaTft/MetaTftClient.php`

The client is the only place that knows MetaTFT URL shapes. Everything downstream consumes DTOs. Use Laravel's `Http` facade (wraps Guzzle) with retry + rate limit.

- [ ] **Step 1: Verify endpoint catalogue from A1**

Read `docs/superpowers/plans/metatft-api-notes.md` for the exact URLs and query params. If anything is unclear, re-run `grep` from A1 Step 1 on specific method calls.

- [ ] **Step 2: Create MetaTftClient**

Create `app/Services/MetaTft/MetaTftClient.php`:

```php
<?php

namespace App\Services\MetaTft;

use App\Services\MetaTft\Dto\AffinityDto;
use App\Services\MetaTft\Dto\CompanionDto;
use App\Services\MetaTft\Dto\MetaCompDto;
use App\Services\MetaTft\Dto\TraitRatingDto;
use App\Services\MetaTft\Dto\UnitRatingDto;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Response;
use RuntimeException;

/**
 * HTTP client for MetaTFT's public API.
 *
 * Uses the `metatft_cache` table as a transparent JSON cache — every
 * request hashes (endpoint, params) and stores the raw body with a
 * TTL. Cache hits short-circuit the HTTP call, cache misses fetch +
 * store. This gives us idempotent sync runs (re-running right after a
 * successful run costs nothing) and survives partial failures.
 *
 * Base URL and exact endpoint paths are extracted from the legacy
 * ratings.service.js — see docs/superpowers/plans/metatft-api-notes.md.
 */
class MetaTftClient
{
    // NOTE: confirm base URL from metatft-api-notes.md. Legacy uses
    // `https://api.metatft.com/tft-comps-api/public/v1`. If missing,
    // fall back to this value and add the correct URL once the API is
    // reachable.
    private const BASE_URL = 'https://api.metatft.com/tft-comps-api/public/v1';

    private const DEFAULT_TTL = 3600; // 1 hour — MetaTFT refreshes aggregates slowly

    public function __construct(
        private readonly HttpFactory $http,
    ) {}

    /**
     * Fetch per-champion ratings for a set.
     *
     * @return list<UnitRatingDto>
     */
    public function fetchUnits(int $setNumber): array
    {
        $payload = $this->getWithCache('units', ['set' => $setNumber]);

        return array_values(array_map(
            fn (array $row) => new UnitRatingDto(
                apiName: $row['unit'] ?? $row['apiName'] ?? '',
                avgPlace: (float) ($row['avg_place'] ?? $row['avgPlace'] ?? 4.5),
                winRate: (float) ($row['win_rate'] ?? $row['winRate'] ?? 0),
                top4Rate: (float) ($row['top4_rate'] ?? $row['top4Rate'] ?? 0),
                games: (int) ($row['games'] ?? 0),
                patch: $row['patch'] ?? null,
            ),
            $payload['units'] ?? $payload ?? [],
        ));
    }

    /**
     * Fetch per-trait-per-breakpoint ratings for a set.
     *
     * @return list<TraitRatingDto>
     */
    public function fetchTraits(int $setNumber): array
    {
        $payload = $this->getWithCache('traits', ['set' => $setNumber]);

        return array_values(array_map(
            fn (array $row) => new TraitRatingDto(
                traitApiName: $row['trait'] ?? $row['apiName'] ?? '',
                breakpointPosition: (int) ($row['breakpoint'] ?? $row['position'] ?? 1),
                avgPlace: (float) ($row['avg_place'] ?? 4.5),
                winRate: (float) ($row['win_rate'] ?? 0),
                top4Rate: (float) ($row['top4_rate'] ?? 0),
                games: (int) ($row['games'] ?? 0),
            ),
            $payload['traits'] ?? $payload ?? [],
        ));
    }

    /**
     * Fetch trait affinity for a single champion. Returns the top N
     * trait matches (N set by MetaTFT, usually 5-10).
     *
     * @return list<AffinityDto>
     */
    public function fetchAffinity(string $championApiName): array
    {
        $payload = $this->getWithCache('explorer/traits', [
            'unit_unique' => $championApiName.'-1',
            'formatnoarray' => 'true',
            'compact' => 'true',
        ]);

        return array_values(array_map(
            fn (array $row) => new AffinityDto(
                championApiName: $championApiName,
                traitApiName: $row['trait'] ?? '',
                breakpointPosition: (int) ($row['breakpoint'] ?? 1),
                avgPlace: (float) ($row['avg_place'] ?? 4.5),
                games: (int) ($row['games'] ?? 0),
                frequency: (float) ($row['frequency'] ?? 0),
            ),
            $payload['traits'] ?? $payload ?? [],
        ));
    }

    /**
     * Fetch companion co-occurrence for a single champion.
     *
     * @return list<CompanionDto>
     */
    public function fetchCompanions(string $championApiName): array
    {
        $payload = $this->getWithCache('explorer/units', [
            'unit_unique' => $championApiName.'-1',
            'formatnoarray' => 'true',
            'compact' => 'true',
        ]);

        return array_values(array_map(
            fn (array $row) => new CompanionDto(
                championApiName: $championApiName,
                companionApiName: $row['unit'] ?? '',
                avgPlace: (float) ($row['avg_place'] ?? 4.5),
                games: (int) ($row['games'] ?? 0),
                frequency: (float) ($row['frequency'] ?? 0),
            ),
            $payload['units'] ?? $payload ?? [],
        ));
    }

    /**
     * Fetch the current set's top meta compositions.
     *
     * @return list<MetaCompDto>
     */
    public function fetchMetaComps(int $setNumber): array
    {
        $payload = $this->getWithCache('comps', ['set' => $setNumber]);

        return array_values(array_map(
            fn (array $row) => new MetaCompDto(
                id: (string) ($row['id'] ?? $row['comp_id'] ?? ''),
                name: (string) ($row['name'] ?? ''),
                championApiNames: array_values($row['champions'] ?? $row['units'] ?? []),
                traitApiNames: array_values($row['traits'] ?? []),
                avgPlace: (float) ($row['avg_place'] ?? 4.5),
                games: (int) ($row['games'] ?? 0),
                level: (int) ($row['level'] ?? 9),
            ),
            $payload['comps'] ?? $payload ?? [],
        ));
    }

    /**
     * Low-level GET with metatft_cache lookup. Hash `(endpoint, params)`
     * to a stable key, check the cache, fetch + store on miss.
     *
     * @param  array<string, mixed>  $params
     * @return array<mixed>
     */
    private function getWithCache(string $endpoint, array $params): array
    {
        ksort($params);
        $paramsHash = hash('sha256', $endpoint.':'.json_encode($params));

        $cached = \App\Models\MetatftCache::query()
            ->where('endpoint', $endpoint)
            ->where('params_hash', $paramsHash)
            ->first();

        if ($cached && $cached->isFresh()) {
            return $cached->data ?? [];
        }

        $response = $this->http
            ->retry(3, 500, throw: false)
            ->timeout(30)
            ->acceptJson()
            ->get(self::BASE_URL.'/'.$endpoint, $params);

        if ($response->failed()) {
            throw new RuntimeException(
                "MetaTFT API failed for /{$endpoint}: HTTP {$response->status()}",
            );
        }

        $data = $response->json() ?? [];

        \App\Models\MetatftCache::query()->updateOrCreate(
            ['endpoint' => $endpoint, 'params_hash' => $paramsHash],
            [
                'params' => $params,
                'data' => $data,
                'fetched_at' => now(),
                'ttl_seconds' => self::DEFAULT_TTL,
            ],
        );

        return $data;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/Services/MetaTft/MetaTftClient.php
git commit -m "feat(scout): add MetaTftClient with transparent cache"
```

---

### Task A5: `MetaTftSync` orchestrator

**Files:**
- Create: `app/Services/MetaTft/MetaTftSync.php`

- [ ] **Step 1: Create MetaTftSync**

Create `app/Services/MetaTft/MetaTftSync.php`:

```php
<?php

namespace App\Services\MetaTft;

use App\Models\Champion;
use App\Models\ChampionCompanion;
use App\Models\ChampionRating;
use App\Models\ChampionTraitAffinity;
use App\Models\MetaComp;
use App\Models\MetaSync;
use App\Models\Set;
use App\Models\TftTrait;
use App\Models\TraitBreakpoint;
use App\Models\TraitRating;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Orchestrates a full MetaTFT sync for one set.
 *
 * Flow:
 *   1. Fetch units + traits + meta_comps via MetaTftClient (bulk)
 *   2. For each playable champion, fetch per-champion affinity + companions
 *   3. Upsert everything inside a single DB transaction so a half-sync
 *      can't leave the DB in a weird state
 *   4. Write a `meta_syncs` row with counts + status
 *
 * Idempotent: safe to re-run. Upserts use `(champion_id, patch)` or
 * equivalent unique constraints to overwrite existing rows.
 */
class MetaTftSync
{
    public function __construct(
        private readonly MetaTftClient $client,
    ) {}

    public function run(int $setNumber): MetaSync
    {
        $set = Set::query()->where('number', $setNumber)->firstOrFail();

        $championsByApiName = Champion::query()
            ->where('set_id', $set->id)
            ->get()
            ->keyBy('api_name');

        $traitsByApiName = TftTrait::query()
            ->where('set_id', $set->id)
            ->get()
            ->keyBy('api_name');

        $status = 'ok';
        $notes = null;
        $counts = [
            'units' => 0,
            'traits' => 0,
            'affinity' => 0,
            'companions' => 0,
            'meta_comps' => 0,
        ];

        try {
            DB::transaction(function () use (
                $set, $championsByApiName, $traitsByApiName, &$counts,
            ) {
                $counts['units'] = $this->syncUnitRatings($set, $championsByApiName);
                $counts['traits'] = $this->syncTraitRatings($set, $traitsByApiName);
                $counts['meta_comps'] = $this->syncMetaComps($set, $championsByApiName, $traitsByApiName);

                // Per-champion fetches run AFTER bulk inserts so the
                // outer transaction rolls back affinity/companions on
                // failure of the bulk block.
                foreach ($championsByApiName as $apiName => $champion) {
                    if (! $champion->is_playable) {
                        continue;
                    }
                    $counts['affinity'] += $this->syncAffinityForChampion(
                        $champion, $traitsByApiName,
                    );
                    $counts['companions'] += $this->syncCompanionsForChampion(
                        $champion, $championsByApiName,
                    );
                }
            });
        } catch (Throwable $e) {
            $status = 'failed';
            $notes = $e->getMessage();
            Log::error('MetaTftSync failed', [
                'set' => $setNumber,
                'error' => $e->getMessage(),
            ]);
        }

        return MetaSync::create([
            'set_id' => $set->id,
            'synced_at' => now(),
            'units_count' => $counts['units'],
            'traits_count' => $counts['traits'],
            'affinity_count' => $counts['affinity'],
            'companions_count' => $counts['companions'],
            'meta_comps_count' => $counts['meta_comps'],
            'status' => $status,
            'notes' => $notes,
        ]);
    }

    private function syncUnitRatings(Set $set, $championsByApiName): int
    {
        $dtos = $this->client->fetchUnits($set->number);
        $count = 0;

        foreach ($dtos as $dto) {
            $champion = $championsByApiName[$dto->apiName] ?? null;
            if ($champion === null) {
                continue;
            }

            ChampionRating::updateOrCreate(
                [
                    'champion_id' => $champion->id,
                    'patch' => $dto->patch,
                ],
                [
                    'set_id' => $set->id,
                    'avg_place' => $dto->avgPlace,
                    'win_rate' => $dto->winRate,
                    'top4_rate' => $dto->top4Rate,
                    'games' => $dto->games,
                    'score' => $dto->score(),
                    'updated_at' => now(),
                ],
            );
            $count++;
        }

        return $count;
    }

    private function syncTraitRatings(Set $set, $traitsByApiName): int
    {
        $dtos = $this->client->fetchTraits($set->number);
        $count = 0;

        foreach ($dtos as $dto) {
            $trait = $traitsByApiName[$dto->traitApiName] ?? null;
            if ($trait === null) {
                continue;
            }

            TraitRating::updateOrCreate(
                [
                    'trait_id' => $trait->id,
                    'breakpoint_position' => $dto->breakpointPosition,
                ],
                [
                    'set_id' => $set->id,
                    'avg_place' => $dto->avgPlace,
                    'win_rate' => $dto->winRate,
                    'top4_rate' => $dto->top4Rate,
                    'games' => $dto->games,
                    'score' => $dto->score(),
                    'updated_at' => now(),
                ],
            );
            $count++;
        }

        return $count;
    }

    private function syncMetaComps(Set $set, $championsByApiName, $traitsByApiName): int
    {
        $dtos = $this->client->fetchMetaComps($set->number);
        $count = 0;

        // Clear-and-rebuild approach: meta comps are few (~30) and the
        // set of valid comps changes between patches. Simpler than
        // diff-upsert via composite keys.
        MetaComp::query()->where('set_id', $set->id)->delete();

        foreach ($dtos as $dto) {
            $comp = MetaComp::create([
                'set_id' => $set->id,
                'external_id' => $dto->id,
                'name' => $dto->name,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'level' => $dto->level,
            ]);

            // Attach champions via pivot (meta_comp_champions).
            $champIds = collect($dto->championApiNames)
                ->map(fn ($api) => $championsByApiName[$api]?->id)
                ->filter()
                ->values()
                ->all();

            if (! empty($champIds)) {
                $comp->champions()->sync($champIds);
            }

            $count++;
        }

        return $count;
    }

    private function syncAffinityForChampion(Champion $champion, $traitsByApiName): int
    {
        try {
            $dtos = $this->client->fetchAffinity($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("Affinity fetch failed for {$champion->api_name}: ".$e->getMessage());

            return 0;
        }

        // Replace strategy — per-champion affinity is small (5-10 rows)
        // and the exact trait list can shift between patches.
        ChampionTraitAffinity::query()
            ->where('champion_id', $champion->id)
            ->delete();

        $count = 0;
        foreach ($dtos as $dto) {
            $trait = $traitsByApiName[$dto->traitApiName] ?? null;
            if ($trait === null) {
                continue;
            }

            ChampionTraitAffinity::create([
                'champion_id' => $champion->id,
                'trait_id' => $trait->id,
                'breakpoint_position' => $dto->breakpointPosition,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
            ]);
            $count++;
        }

        return $count;
    }

    private function syncCompanionsForChampion(Champion $champion, $championsByApiName): int
    {
        try {
            $dtos = $this->client->fetchCompanions($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("Companions fetch failed for {$champion->api_name}: ".$e->getMessage());

            return 0;
        }

        ChampionCompanion::query()
            ->where('champion_id', $champion->id)
            ->delete();

        $count = 0;
        foreach ($dtos as $dto) {
            $companion = $championsByApiName[$dto->companionApiName] ?? null;
            if ($companion === null) {
                continue;
            }

            ChampionCompanion::create([
                'champion_id' => $champion->id,
                'companion_id' => $companion->id,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
            ]);
            $count++;
        }

        return $count;
    }
}
```

- [ ] **Step 2: Verify model/column alignment**

Run:
```bash
php artisan tinker --execute='echo json_encode(\Schema::getColumnListing("champion_ratings"))."\n".json_encode(\Schema::getColumnListing("champion_trait_affinity"))."\n".json_encode(\Schema::getColumnListing("champion_companions"))."\n".json_encode(\Schema::getColumnListing("meta_comps"));'
```

Expected: column lists for each table. Confirm the `updateOrCreate` / `create` calls in MetaTftSync reference only columns that actually exist. If any mismatch, patch MetaTftSync to match.

- [ ] **Step 3: Commit**

```bash
git add app/Services/MetaTft/MetaTftSync.php
git commit -m "feat(scout): add MetaTftSync orchestrator"
```

---

### Task A6: Artisan command + queue job

**Files:**
- Create: `app/Console/Commands/MetaTftSync.php`
- Create: `app/Jobs/RefreshMetaTftJob.php`

- [ ] **Step 1: Create the Artisan command**

Create `app/Console/Commands/MetaTftSync.php`:

```php
<?php

namespace App\Console\Commands;

use App\Services\MetaTft\MetaTftSync as MetaTftSyncService;
use Illuminate\Console\Command;

class MetaTftSync extends Command
{
    protected $signature = 'metatft:sync {--set=17 : Set number to sync}';

    protected $description = 'Fetch MetaTFT aggregates and populate scout rating tables';

    public function handle(MetaTftSyncService $sync): int
    {
        $setNumber = (int) $this->option('set');

        $this->info("Syncing MetaTFT data for set {$setNumber}...");
        $start = microtime(true);

        $record = $sync->run($setNumber);

        $elapsed = round(microtime(true) - $start, 2);

        if ($record->status === 'ok') {
            $this->info("✓ Sync complete in {$elapsed}s");
        } else {
            $this->error("✗ Sync {$record->status} in {$elapsed}s — {$record->notes}");
        }

        $this->table(
            ['Category', 'Count'],
            [
                ['units', $record->units_count],
                ['traits', $record->traits_count],
                ['affinity', $record->affinity_count],
                ['companions', $record->companions_count],
                ['meta_comps', $record->meta_comps_count],
            ],
        );

        return $record->status === 'ok' ? Command::SUCCESS : Command::FAILURE;
    }
}
```

- [ ] **Step 2: Create the refresh job**

Create `app/Jobs/RefreshMetaTftJob.php`:

```php
<?php

namespace App\Jobs;

use App\Services\MetaTft\MetaTftSync;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Background sync job dispatched by ScoutController when the latest
 * meta_syncs row is older than 24h. Stale-while-revalidate: scout
 * requests return current data immediately, this job refreshes it
 * out-of-band for the next request.
 */
class RefreshMetaTftJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(
        public readonly int $setNumber,
    ) {}

    public function handle(MetaTftSync $sync): void
    {
        $sync->run($this->setNumber);
    }
}
```

- [ ] **Step 3: Dry-run the command**

Run:
```bash
php artisan metatft:sync --set=17 2>&1 | tail -20
```

Expected: either a full success table, or a warning if MetaTFT API URLs aren't right yet. A failure here is OK for now — it means the client fell back and `meta_syncs` has a `failed` row. Check the row:

```bash
php artisan tinker --execute='echo \App\Models\MetaSync::latest("id")->first()->toJson();'
```

Expected: a row with `status=ok` or `status=failed` + notes. If `failed`, iterate on the URL/endpoint shape in `MetaTftClient` until you get `ok`.

- [ ] **Step 4: Commit**

```bash
git add app/Console/Commands/MetaTftSync.php app/Jobs/RefreshMetaTftJob.php
git commit -m "feat(scout): add metatft:sync command + refresh job"
```

**Gate — end of Phase A.** Before moving on, `php artisan metatft:sync --set=17` should write a row with `status=ok`. If it doesn't, fix the endpoint mismatch first — nothing in Phase B-E helps if the data isn't there.

---

## Phase B — Scout context endpoint

Goal: `GET /api/scout/context` returns a JSON payload shaped like the legacy `ctx.json` used by `scout.worker.js`. Manual `curl` sanity check passes.

### Task B1: `ScoutContextBuilder`

**Files:**
- Create: `app/Services/Scout/ScoutContextBuilder.php`

- [ ] **Step 1: Create the builder**

Create `app/Services/Scout/ScoutContextBuilder.php`:

```php
<?php

namespace App\Services\Scout;

use App\Models\Champion;
use App\Models\ChampionCompanion;
use App\Models\ChampionRating;
use App\Models\ChampionTraitAffinity;
use App\Models\MetaComp;
use App\Models\MetaSync;
use App\Models\Set;
use App\Models\TftTrait;
use App\Models\TraitRating;
use App\Models\TraitStyle;

/**
 * Assembles the JSON payload that the scout Web Worker consumes.
 *
 * Shape mirrors legacy `ctx` object from
 * `legacy/tft-generator/client/src/workers/scout.worker.js` so the port
 * can consume it 1:1 with minimal changes. See the spec for full field
 * definitions.
 */
class ScoutContextBuilder
{
    public function build(int $setNumber): array
    {
        $set = Set::query()->where('number', $setNumber)->firstOrFail();

        $champions = $this->buildChampions($set);
        $traits = $this->buildTraits($set);
        $exclusionGroups = $this->buildExclusionGroups($set);
        $scoringCtx = $this->buildScoringCtx($set);

        $lastSync = MetaSync::query()
            ->where('set_id', $set->id)
            ->where('status', 'ok')
            ->orderByDesc('synced_at')
            ->first();

        $syncedAt = $lastSync?->synced_at?->toIso8601String();
        $stale = $lastSync === null
            || $lastSync->synced_at->lt(now()->subHours(24));

        return [
            'champions' => $champions,
            'traits' => $traits,
            'exclusionGroups' => $exclusionGroups,
            'scoringCtx' => $scoringCtx,
            'syncedAt' => $syncedAt,
            'stale' => $stale,
        ];
    }

    private function buildChampions(Set $set): array
    {
        return Champion::query()
            ->where('set_id', $set->id)
            ->where('is_playable', true)
            ->with(['traits:id,api_name,name'])
            ->get()
            ->map(fn (Champion $c) => [
                'apiName' => $c->api_name,
                'name' => $c->name,
                'cost' => $c->cost,
                'traits' => $c->traits->pluck('api_name')->all(),
                'traitNames' => $c->traits->pluck('name')->all(),
                'slotsUsed' => $c->slots_used,
                'baseApiName' => $c->baseChampion?->api_name,
                'variant' => $c->variant_label,
                'role' => $c->role,
                'damageType' => $c->damage_type,
                'roleCategory' => $c->role_category,
                'icon' => '/icons/champions/'.$c->api_name.'.png',
                'abilityIcon' => $c->ability_icon_path
                    ? '/icons/abilities/'.$c->api_name.'.png'
                    : null,
                'plannerCode' => $c->planner_code,
            ])
            ->values()
            ->all();
    }

    private function buildTraits(Set $set): array
    {
        $styles = TraitStyle::pluck('name', 'id')->all();

        return TftTrait::query()
            ->where('set_id', $set->id)
            ->whereIn('category', ['public', 'unique'])
            ->with('breakpoints')
            ->get()
            ->map(fn (TftTrait $t) => [
                'apiName' => $t->api_name,
                'name' => $t->name,
                'category' => $t->category,
                'breakpoints' => $t->breakpoints
                    ->sortBy('position')
                    ->map(fn ($bp) => [
                        'position' => $bp->position,
                        'minUnits' => $bp->min_units,
                        'maxUnits' => $bp->max_units >= 25000 ? null : $bp->max_units,
                        'style' => $styles[$bp->style_id] ?? null,
                    ])
                    ->values()
                    ->all(),
                'icon' => '/icons/traits/'.$t->api_name.'.png',
            ])
            ->values()
            ->all();
    }

    /**
     * Convert `base_champion_id` self-FK into the shape the legacy
     * algorithm expects: a list of mutually-exclusive apiName groups.
     * Each group holds champions that cannot appear together in a team
     * (MF Conduit/Challenger/Replicator, Galio/Galio Enhanced, etc.).
     */
    private function buildExclusionGroups(Set $set): array
    {
        $champions = Champion::query()
            ->where('set_id', $set->id)
            ->get(['id', 'api_name', 'base_champion_id', 'is_playable']);

        $groups = [];
        foreach ($champions as $champ) {
            $rootId = $champ->base_champion_id ?? $champ->id;
            $groups[$rootId] ??= [];
            if ($champ->is_playable) {
                $groups[$rootId][] = $champ->api_name;
            }
        }

        // Drop single-member groups — nothing to exclude if only one
        // playable variant exists (e.g. base champion with no hero form).
        return array_values(array_filter(
            $groups,
            fn (array $group) => count($group) > 1,
        ));
    }

    /**
     * The flat scoring context consumed by the worker. Keeps legacy
     * naming (`unitRatings` etc.) so the ported algorithm doesn't need
     * rewrites in quickScore / fullScore lookups.
     */
    private function buildScoringCtx(Set $set): array
    {
        return [
            'unitRatings' => $this->buildUnitRatings($set),
            'traitRatings' => $this->buildTraitRatings($set),
            'affinity' => $this->buildAffinity($set),
            'companions' => $this->buildCompanions($set),
            'metaComps' => $this->buildMetaComps($set),
            'styleScores' => $this->buildStyleScores(),
        ];
    }

    private function buildUnitRatings(Set $set): array
    {
        return ChampionRating::query()
            ->join('champions', 'champions.id', '=', 'champion_ratings.champion_id')
            ->where('champion_ratings.set_id', $set->id)
            ->get([
                'champions.api_name as api_name',
                'champion_ratings.avg_place',
                'champion_ratings.win_rate',
                'champion_ratings.top4_rate',
                'champion_ratings.games',
                'champion_ratings.score',
            ])
            ->mapWithKeys(fn ($row) => [
                $row->api_name => [
                    'avgPlace' => (float) $row->avg_place,
                    'winRate' => (float) $row->win_rate,
                    'top4Rate' => (float) $row->top4_rate,
                    'games' => (int) $row->games,
                    'score' => (float) $row->score,
                ],
            ])
            ->all();
    }

    private function buildTraitRatings(Set $set): array
    {
        $rows = TraitRating::query()
            ->join('traits', 'traits.id', '=', 'trait_ratings.trait_id')
            ->where('trait_ratings.set_id', $set->id)
            ->get([
                'traits.api_name as api_name',
                'trait_ratings.breakpoint_position',
                'trait_ratings.avg_place',
                'trait_ratings.win_rate',
                'trait_ratings.games',
                'trait_ratings.score',
            ]);

        $map = [];
        foreach ($rows as $row) {
            $map[$row->api_name] ??= [];
            $map[$row->api_name][(int) $row->breakpoint_position] = [
                'avgPlace' => (float) $row->avg_place,
                'winRate' => (float) $row->win_rate,
                'games' => (int) $row->games,
                'score' => (float) $row->score,
            ];
        }

        return $map;
    }

    private function buildAffinity(Set $set): array
    {
        $rows = ChampionTraitAffinity::query()
            ->join('champions', 'champions.id', '=', 'champion_trait_affinity.champion_id')
            ->join('traits', 'traits.id', '=', 'champion_trait_affinity.trait_id')
            ->where('champions.set_id', $set->id)
            ->orderBy('champions.api_name')
            ->orderBy('champion_trait_affinity.avg_place')
            ->get([
                'champions.api_name as champ_api',
                'traits.api_name as trait_api',
                'champion_trait_affinity.breakpoint_position',
                'champion_trait_affinity.avg_place',
                'champion_trait_affinity.games',
                'champion_trait_affinity.frequency',
            ]);

        $map = [];
        foreach ($rows as $row) {
            $map[$row->champ_api] ??= [];
            $map[$row->champ_api][] = [
                'trait' => $row->trait_api,
                'breakpoint' => (int) $row->breakpoint_position,
                'avgPlace' => (float) $row->avg_place,
                'games' => (int) $row->games,
                'frequency' => (float) $row->frequency,
            ];
        }

        return $map;
    }

    private function buildCompanions(Set $set): array
    {
        $rows = ChampionCompanion::query()
            ->join('champions as c1', 'c1.id', '=', 'champion_companions.champion_id')
            ->join('champions as c2', 'c2.id', '=', 'champion_companions.companion_id')
            ->where('c1.set_id', $set->id)
            ->orderBy('c1.api_name')
            ->orderBy('champion_companions.avg_place')
            ->get([
                'c1.api_name as champ_api',
                'c2.api_name as companion_api',
                'champion_companions.avg_place',
                'champion_companions.games',
                'champion_companions.frequency',
            ]);

        $map = [];
        foreach ($rows as $row) {
            $map[$row->champ_api] ??= [];
            $map[$row->champ_api][] = [
                'companion' => $row->companion_api,
                'avgPlace' => (float) $row->avg_place,
                'games' => (int) $row->games,
                'frequency' => (float) $row->frequency,
            ];
        }

        return $map;
    }

    private function buildMetaComps(Set $set): array
    {
        return MetaComp::query()
            ->where('set_id', $set->id)
            ->with('champions:id,api_name')
            ->orderBy('avg_place')
            ->get()
            ->map(fn (MetaComp $comp) => [
                'id' => $comp->external_id,
                'name' => $comp->name,
                'champs' => $comp->champions->pluck('api_name')->all(),
                'avgPlace' => (float) $comp->avg_place,
                'games' => (int) $comp->games,
                'level' => (int) $comp->level,
            ])
            ->values()
            ->all();
    }

    private function buildStyleScores(): array
    {
        return TraitStyle::query()
            ->get()
            ->mapWithKeys(fn (TraitStyle $s) => [$s->name => (float) $s->fallback_score])
            ->all();
    }
}
```

- [ ] **Step 2: Verify model relationships**

Check that `MetaComp` model has a `champions()` relation and `external_id` column. If not present:

```bash
grep -n "external_id\|champions()" app/Models/MetaComp.php
```

If `external_id` is missing, add it to the migration for `meta_comps` (use `php artisan make:migration add_external_id_to_meta_comps`) and update the model's `$fillable`. Similarly for the `champions()` belongsToMany relation via `meta_comp_champions`.

- [ ] **Step 3: Commit**

```bash
git add app/Services/Scout/ScoutContextBuilder.php
git commit -m "feat(scout): add ScoutContextBuilder for worker JSON payload"
```

---

### Task B2: `ScoutController` + routes + Inertia page stub

**Files:**
- Create: `app/Http/Controllers/ScoutController.php`
- Create: `resources/js/pages/Scout/Index.tsx` (stub — just renders "Scout")
- Modify: `routes/web.php` — add `/scout` and `/api/scout/context` routes

- [ ] **Step 1: Create the controller**

Create `app/Http/Controllers/ScoutController.php`:

```php
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
```

- [ ] **Step 2: Create the stub page**

Create `resources/js/pages/Scout/Index.tsx`:

```tsx
import { Head } from '@inertiajs/react';
import AppLayout from '@/layouts/app-layout';

type Props = {
    setNumber: number;
};

export default function ScoutIndex({ setNumber }: Props) {
    return (
        <>
            <Head title="Scout — TFT Scout" />
            <div className="p-6">
                <h1 className="text-2xl font-bold">Scout (Set {setNumber})</h1>
                <p className="text-sm text-muted-foreground">
                    Worker + UI not wired yet — see Task C1 onwards.
                </p>
            </div>
        </>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[
            { title: 'Scout', href: '/scout' },
        ]}
    >
        {page}
    </AppLayout>
);
```

- [ ] **Step 3: Register routes**

Edit `routes/web.php` to add:

```php
use App\Http\Controllers\ScoutController;

Route::get('/scout', [ScoutController::class, 'index'])->name('scout.index');
Route::get('/api/scout/context', [ScoutController::class, 'context'])->name('scout.context');
```

Note: `/api/scout/context` lives in `web.php` (not `api.php`) because the same session/CSRF middleware handles both and the worker uses a same-origin fetch.

- [ ] **Step 4: Verify manually**

Run:
```bash
curl -s http://tft-scout.test/api/scout/context | head -c 500
```

Expected: JSON starting with `{"champions":[...`, including `scoringCtx`, `exclusionGroups`, `syncedAt`, `stale` keys. If errors, check the controller and model method names.

- [ ] **Step 5: Commit**

```bash
git add app/Http/Controllers/ScoutController.php resources/js/pages/Scout/Index.tsx routes/web.php
git commit -m "feat(scout): add /scout page stub + /api/scout/context endpoint"
```

---

### Task B3: Integration test for context shape

**Files:**
- Create: `tests/Feature/ScoutContextTest.php`

Small safety net: catches schema regressions when future migrations change column names.

- [ ] **Step 1: Write the test**

Create `tests/Feature/ScoutContextTest.php`:

```php
<?php

namespace Tests\Feature;

use Tests\TestCase;

class ScoutContextTest extends TestCase
{
    public function test_context_endpoint_returns_top_level_shape(): void
    {
        $response = $this->getJson('/api/scout/context');

        $response->assertOk();
        $response->assertJsonStructure([
            'champions',
            'traits',
            'exclusionGroups',
            'scoringCtx' => [
                'unitRatings',
                'traitRatings',
                'affinity',
                'companions',
                'metaComps',
                'styleScores',
            ],
            'syncedAt',
            'stale',
        ]);
    }

    public function test_champions_include_required_fields(): void
    {
        $response = $this->getJson('/api/scout/context');
        $champion = $response->json('champions.0');

        $this->assertIsArray($champion);
        $this->assertArrayHasKey('apiName', $champion);
        $this->assertArrayHasKey('cost', $champion);
        $this->assertArrayHasKey('traits', $champion);
        $this->assertArrayHasKey('slotsUsed', $champion);
    }

    public function test_traits_include_breakpoints(): void
    {
        $response = $this->getJson('/api/scout/context');
        $trait = $response->json('traits.0');

        $this->assertIsArray($trait);
        $this->assertArrayHasKey('breakpoints', $trait);
        $this->assertIsArray($trait['breakpoints']);
    }
}
```

- [ ] **Step 2: Run the test**

Run:
```bash
php artisan test --filter=ScoutContextTest
```

Expected: `Tests: 3 passed`. If any test fails, fix the builder to match the expected shape and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/Feature/ScoutContextTest.php
git commit -m "test(scout): verify /api/scout/context shape"
```

**Gate — end of Phase B.** `curl http://tft-scout.test/api/scout/context` returns valid JSON with all expected keys, test suite passes.

---

## Phase C — Worker infrastructure + algorithm port

Goal: worker compiles, hook spawns it, algorithm files port cleanly, smoke test runs generate with real context and returns results.

### Task C1: TypeScript boundary types

**Files:**
- Create: `resources/js/workers/scout/types.ts`

- [ ] **Step 1: Create types**

Create `resources/js/workers/scout/types.ts`:

```typescript
// Public types exposed across the worker boundary. The algorithm
// internals use plain JS objects (ported 1:1 from legacy) and stay
// loosely typed — only these top-level shapes are declared.

export type Champion = {
    apiName: string;
    name: string;
    cost: number;
    traits: string[];        // trait api_names
    traitNames: string[];    // human-readable names (for UI rendering)
    slotsUsed: number;       // 2 for Mecha Enhanced
    baseApiName: string | null;
    variant: string | null;  // 'hero' | 'conduit' | 'challenger' | ...
    role: string | null;
    damageType: string | null;
    roleCategory: string | null;
    icon: string;
    abilityIcon: string | null;
    plannerCode: number | null;
};

export type TraitBreakpoint = {
    position: number;
    minUnits: number;
    maxUnits: number | null;
    style: 'Bronze' | 'Silver' | 'Gold' | 'Prismatic' | 'Unique' | null;
};

export type Trait = {
    apiName: string;
    name: string;
    category: 'public' | 'unique';
    breakpoints: TraitBreakpoint[];
    icon: string;
};

export type UnitRating = {
    avgPlace: number;
    winRate: number;
    top4Rate: number;
    games: number;
    score: number;
};

export type TraitRatingEntry = {
    avgPlace: number;
    winRate: number;
    games: number;
    score: number;
};

export type AffinityEntry = {
    trait: string;
    breakpoint: number;
    avgPlace: number;
    games: number;
    frequency: number;
};

export type CompanionEntry = {
    companion: string;
    avgPlace: number;
    games: number;
    frequency: number;
};

export type MetaCompEntry = {
    id: string;
    name: string;
    champs: string[];
    avgPlace: number;
    games: number;
    level: number;
};

export type ScoringContext = {
    unitRatings: Record<string, UnitRating>;
    traitRatings: Record<string, Record<number, TraitRatingEntry>>;
    affinity: Record<string, AffinityEntry[]>;
    companions: Record<string, CompanionEntry[]>;
    metaComps: MetaCompEntry[];
    styleScores: Record<string, number>;
};

export type ScoutContext = {
    champions: Champion[];
    traits: Trait[];
    exclusionGroups: string[][];
    scoringCtx: ScoringContext;
    syncedAt: string | null;
    stale: boolean;
};

export type ScoutConstraints = {
    lockedChampions: string[];
    excludedChampions: string[];
    lockedTraits: { apiName: string; minUnits: number }[];
    excludedTraits: string[];
    emblems: { apiName: string; count: number }[];
    max5Cost: number | null;
    roleBalance: boolean | null;
};

export type ScoutParams = {
    lockedChampions?: string[];
    excludedChampions?: string[];
    lockedTraits?: { apiName: string; minUnits: number }[];
    excludedTraits?: string[];
    emblems?: { apiName: string; count: number }[];
    level?: number;
    topN?: number;
    max5Cost?: number | null;
    roleBalance?: boolean | null;
    seed?: number;
};

export type ScoredTeamChampion = {
    apiName: string;
    baseApiName: string | null;
    name: string;
    cost: number;
    role: string | null;
    traits: string[];
    traitNames: string[];
    variant: string | null;
    slotsUsed: number;
    icon: string;
    plannerCode: number | null;
};

export type ScoredActiveTrait = {
    apiName: string;
    name: string;
    icon: string | null;
    count: number;
    style: string | null;
    breakpoint: number | null;
};

export type ScoredTeam = {
    champions: ScoredTeamChampion[];
    activeTraits: ScoredActiveTrait[];
    score: number;
    breakdown: Record<string, number> | null;
    level: number;
    slotsUsed: number;
    roles: Record<string, number> | null;
    metaMatch: { id: string; name: string; similarity: number } | null;
};

export type WorkerInMsg =
    | { type: 'generate'; id: number; params: ScoutParams }
    | { type: 'roadTo'; id: number; params: unknown };

export type WorkerOutMsg =
    | { id: number; result: { results: ScoredTeam[]; insights: unknown } }
    | { id: number; error: string };
```

- [ ] **Step 2: Run type check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors in the new file. If existing project errors are present, focus only on `resources/js/workers/scout/types.ts` — downstream files will add their own types later.

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/types.ts
git commit -m "feat(scout): add worker boundary TypeScript types"
```

---

### Task C2: Port `config.ts`

**Files:**
- Read-only: `legacy/tft-generator/client/src/algorithm/config.js`
- Create: `resources/js/workers/scout/config.ts`

- [ ] **Step 1: Copy and rename**

Run:
```bash
cp legacy/tft-generator/client/src/algorithm/config.js resources/js/workers/scout/config.ts
```

- [ ] **Step 2: Adapt to TS syntax**

Open `resources/js/workers/scout/config.ts` and:
- Remove any leading comment pointing back at the legacy path
- Convert `export const X = ...` statements to have explicit types on any simple constants (`export const TRAIT_RATING_WEIGHT: number = 15.0;`)
- If the file uses `module.exports`, convert to `export`
- Leave literal object/array structures untouched

Keep every weight/threshold value identical — this is the tuning surface of the algorithm and any change is a regression.

- [ ] **Step 3: Type check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors in `config.ts`.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/config.ts
git commit -m "feat(scout): port config.js → config.ts (1:1, weights unchanged)"
```

---

### Task C3: Port small leaf files (`candidates`, `active-traits`, `re-score`)

**Files:**
- Read-only: `legacy/tft-generator/client/src/algorithm/candidates.js`
- Read-only: `legacy/tft-generator/client/src/algorithm/active-traits.js`
- Read-only: `legacy/tft-generator/client/src/algorithm/re-score.js`
- Create: `resources/js/workers/scout/candidates.ts`
- Create: `resources/js/workers/scout/active-traits.ts`
- Create: `resources/js/workers/scout/re-score.ts`

These three files are standalone helpers with no cross-imports. Port them together because they each take ~5 minutes.

- [ ] **Step 1: Copy all three**

Run:
```bash
cp legacy/tft-generator/client/src/algorithm/candidates.js resources/js/workers/scout/candidates.ts
cp legacy/tft-generator/client/src/algorithm/active-traits.js resources/js/workers/scout/active-traits.ts
cp legacy/tft-generator/client/src/algorithm/re-score.js resources/js/workers/scout/re-score.ts
```

- [ ] **Step 2: Fix imports + exports in each file**

For each of the three files:
- Replace `import { X } from '../foo.js'` with `import { X } from './foo'` (drop `.js`, change relative path if needed)
- Leave function signatures untouched — internals stay JS-style
- Only add types at the top-level function signature if TypeScript complains about implicit any

- [ ] **Step 3: Type check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors. If implicit-any errors appear, silence them narrowly with `// @ts-expect-error -- legacy port, see task C3` rather than annotating.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/candidates.ts resources/js/workers/scout/active-traits.ts resources/js/workers/scout/re-score.ts
git commit -m "feat(scout): port candidates/active-traits/re-score to TS"
```

---

### Task C4: Port `scorer.ts`

**Files:**
- Read-only: `legacy/tft-generator/client/src/algorithm/scorer.js`
- Create: `resources/js/workers/scout/scorer.ts`

- [ ] **Step 1: Copy**

Run:
```bash
cp legacy/tft-generator/client/src/algorithm/scorer.js resources/js/workers/scout/scorer.ts
```

- [ ] **Step 2: Adapt imports**

Update top of file:
- `import { ... } from '../foo.js'` → `import { ... } from './foo'`
- Any `import { ... } from './config.js'` becomes `import { ... } from './config'`

- [ ] **Step 3: Type check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors, or only narrow implicit-any errors silenced with `// @ts-expect-error`.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/scorer.ts
git commit -m "feat(scout): port scorer.js → scorer.ts"
```

---

### Task C5: Port `synergy-graph.ts`

**Files:**
- Read-only: `legacy/tft-generator/client/src/algorithm/synergy-graph.js` (903 lines)
- Create: `resources/js/workers/scout/synergy-graph.ts`

This is the biggest file. Port is still mechanical — same rules as C3/C4.

- [ ] **Step 1: Copy**

Run:
```bash
cp legacy/tft-generator/client/src/algorithm/synergy-graph.js resources/js/workers/scout/synergy-graph.ts
```

- [ ] **Step 2: Fix imports**

Update imports to drop `.js` extensions and use relative `./foo` paths.

- [ ] **Step 3: Type check**

Run:
```bash
npx tsc --noEmit 2>&1 | grep "synergy-graph"
```

Expected: no errors in synergy-graph, or a handful of implicit-any warnings. Silence those with `// @ts-expect-error` comments — **do not refactor to add types**. This is the file where refactoring is highest risk of regression.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "feat(scout): port synergy-graph.js → synergy-graph.ts (1:1 port)"
```

---

### Task C6: Port `engine.ts` and `insights.ts`

**Files:**
- Read-only: `legacy/tft-generator/client/src/algorithm/engine.js`
- Read-only: `legacy/tft-generator/client/src/algorithm/insights.js`
- Create: `resources/js/workers/scout/engine.ts`
- Create: `resources/js/workers/scout/insights.ts`

- [ ] **Step 1: Copy both**

Run:
```bash
cp legacy/tft-generator/client/src/algorithm/engine.js resources/js/workers/scout/engine.ts
cp legacy/tft-generator/client/src/algorithm/insights.js resources/js/workers/scout/insights.ts
```

- [ ] **Step 2: Fix imports in both**

Same rules as prior port tasks — drop `.js`, relative paths.

- [ ] **Step 3: Type check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors across all ported files.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/engine.ts resources/js/workers/scout/insights.ts
git commit -m "feat(scout): port engine.js + insights.js"
```

---

### Task C7: Worker entry (`index.ts`)

**Files:**
- Read-only: `legacy/tft-generator/client/src/workers/scout.worker.js`
- Create: `resources/js/workers/scout/index.ts`

- [ ] **Step 1: Create the worker entry**

Create `resources/js/workers/scout/index.ts`:

```typescript
/// <reference lib="webworker" />
// Scout Web Worker. Ported from
// legacy/tft-generator/client/src/workers/scout.worker.js.
// Fetches /api/scout/context on first message, then runs the generate
// / roadTo pipelines from the ported algorithm modules.

import { generate } from './engine';
import { generateInsights } from './insights';
import type { ScoutContext, ScoutParams, ScoredTeam, WorkerInMsg, WorkerOutMsg } from './types';

declare const self: DedicatedWorkerGlobalScope;

let cachedContext: ScoutContext | null = null;

async function fetchContext(): Promise<ScoutContext> {
    if (cachedContext) return cachedContext;
    const res = await fetch('/api/scout/context', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`Context fetch failed: ${res.status}`);
    cachedContext = (await res.json()) as ScoutContext;
    return cachedContext;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapResult(r: any): ScoredTeam {
    return {
        champions: (r.champions ?? []).map((c: any) => ({
            apiName: c.apiName,
            baseApiName: c.baseApiName ?? null,
            name: c.name,
            cost: c.cost,
            role: c.role ?? null,
            traits: c.traits ?? [],
            traitNames: c.traitNames ?? c.traits ?? [],
            variant: c.variant ?? null,
            slotsUsed: c.slotsUsed ?? 1,
            icon: c.icon ?? '',
            plannerCode: c.plannerCode ?? null,
        })),
        activeTraits: (r.activeTraits ?? []).map((t: any) => ({
            apiName: t.apiName,
            name: t.name,
            icon: t.icon ?? null,
            count: t.count,
            style: t.activeStyle ?? null,
            breakpoint: t.activeBreakpoint ?? null,
        })),
        score: Math.round(r.score * 100) / 100,
        breakdown: r.breakdown ?? null,
        level: r.level,
        slotsUsed: r.slotsUsed,
        roles: r.roles ?? null,
        metaMatch: r.metaMatch ?? null,
    };
}

async function runGenerate(ctx: ScoutContext, params: ScoutParams) {
    const {
        lockedChampions = [],
        excludedChampions = [],
        lockedTraits = [],
        excludedTraits = [],
        emblems = [],
        level = 8,
        topN = 10,
        max5Cost = null,
        roleBalance = null,
        seed = 0,
    } = params;

    const results = generate({
        champions: ctx.champions,
        traits: ctx.traits,
        scoringCtx: ctx.scoringCtx,
        constraints: {
            lockedChampions,
            excludedChampions,
            lockedTraits,
            excludedTraits,
            emblems,
            max5Cost,
            roleBalance,
        },
        exclusionGroups: ctx.exclusionGroups,
        level,
        topN,
        seed,
    });

    const insights = generateInsights({
        champions: ctx.champions,
        traits: ctx.traits,
        lockedChampions,
        emblems,
        level,
        scoringCtx: ctx.scoringCtx,
    });

    return { results: results.map(mapResult), insights };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

self.onmessage = async (e: MessageEvent<WorkerInMsg>) => {
    const msg = e.data;

    try {
        const ctx = await fetchContext();

        if (msg.type === 'generate') {
            const result = await runGenerate(ctx, msg.params);
            const out: WorkerOutMsg = { id: msg.id, result };
            self.postMessage(out);
        } else {
            // roadTo deferred to post-MVP per spec
            throw new Error(`Unknown or deferred message type: ${msg.type}`);
        }
    } catch (err) {
        const out: WorkerOutMsg = {
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
        };
        self.postMessage(out);
    }
};
```

- [ ] **Step 2: Type check**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/index.ts
git commit -m "feat(scout): add scout worker entry (fetches /api/scout/context)"
```

---

### Task C8: `useScoutWorker` hook + smoke test

**Files:**
- Read-only: `legacy/tft-generator/client/src/hooks/useScoutWorker.js`
- Create: `resources/js/hooks/use-scout-worker.ts`
- Modify: `resources/js/pages/Scout/Index.tsx` — wire up the hook

- [ ] **Step 1: Create the hook**

Create `resources/js/hooks/use-scout-worker.ts`:

```typescript
import { useCallback, useEffect, useRef } from 'react';
import type { ScoutParams, ScoredTeam, WorkerOutMsg } from '@/workers/scout/types';

// Singleton worker shared across all hook consumers on a page.
// Legacy pattern — one worker instance for the entire /scout session,
// terminated when every consumer unmounts.

let sharedWorker: Worker | null = null;
let refCount = 0;
let msgId = 0;

type Pending = {
    resolve: (value: { results: ScoredTeam[]; insights: unknown }) => void;
    reject: (reason: Error) => void;
};

const pending = new Map<number, Pending>();

function getWorker(): Worker {
    if (!sharedWorker) {
        sharedWorker = new Worker(
            new URL('../workers/scout/index.ts', import.meta.url),
            { type: 'module' },
        );
        sharedWorker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
            const msg = e.data;
            const handler = pending.get(msg.id);
            if (!handler) return;
            pending.delete(msg.id);

            if ('error' in msg) {
                handler.reject(new Error(msg.error));
            } else {
                handler.resolve(msg.result);
            }
        };
    }
    refCount++;
    return sharedWorker;
}

function releaseWorker() {
    refCount--;
    if (refCount <= 0 && sharedWorker) {
        sharedWorker.terminate();
        sharedWorker = null;
        refCount = 0;
        pending.clear();
    }
}

function sendMessage(type: 'generate', params: ScoutParams) {
    const id = ++msgId;
    return new Promise<{ results: ScoredTeam[]; insights: unknown }>(
        (resolve, reject) => {
            pending.set(id, { resolve, reject });
            sharedWorker!.postMessage({ type, id, params });
        },
    );
}

export function useScoutWorker() {
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        workerRef.current = getWorker();
        return () => releaseWorker();
    }, []);

    const generate = useCallback((params: ScoutParams) => {
        return sendMessage('generate', params);
    }, []);

    return { generate };
}
```

- [ ] **Step 2: Wire up the hook in the stub page**

Replace `resources/js/pages/Scout/Index.tsx` with:

```tsx
import { Head } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import type { ScoredTeam } from '@/workers/scout/types';

type Props = {
    setNumber: number;
};

export default function ScoutIndex({ setNumber }: Props) {
    const { generate } = useScoutWorker();
    const [results, setResults] = useState<ScoredTeam[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setIsRunning(true);
        generate({ level: 8, topN: 10 })
            .then((out) => {
                if (!cancelled) {
                    setResults(out.results);
                    setIsRunning(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message);
                    setIsRunning(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [generate]);

    return (
        <>
            <Head title="Scout — TFT Scout" />
            <div className="flex flex-col gap-4 p-6">
                <h1 className="text-2xl font-bold">Scout (Set {setNumber})</h1>
                {isRunning && <p className="text-sm">Running scout…</p>}
                {error && <p className="text-sm text-red-500">{error}</p>}
                {!isRunning && !error && (
                    <p className="text-sm text-muted-foreground">
                        Got {results.length} results. UI comes in Phase D.
                    </p>
                )}
                <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(results.slice(0, 2), null, 2)}
                </pre>
            </div>
        </>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'Scout', href: '/scout' }]}>
        {page}
    </AppLayout>
);
```

- [ ] **Step 3: Manual smoke test**

Run the dev server if not running:
```bash
npm run dev
```

Navigate to `http://tft-scout.test/scout` in a browser. Open DevTools console.

Expected:
- Page renders "Scout (Set 17)" heading
- "Running scout…" appears briefly
- "Got N results." appears where N > 0
- No console errors
- The `<pre>` shows two ScoredTeam JSON samples

If the worker fails to initialise, check `chrome://inspect` → worker console for module-resolution errors (usually an import path that wasn't updated from `.js` to `./foo`). Fix the port file and refresh.

- [ ] **Step 4: Commit**

```bash
git add resources/js/hooks/use-scout-worker.ts resources/js/pages/Scout/Index.tsx
git commit -m "feat(scout): wire up Web Worker with useScoutWorker hook + smoke test"
```

**Gate — end of Phase C.** Scout worker runs end-to-end on real data. If results are empty or insane, before proceeding:
1. Compare with legacy running on the same data (`cd legacy/tft-generator && node server/src/...` if still runnable)
2. Bisect the last ported file that introduced the regression
3. Check TypeScript configuration didn't silently drop a field

---

## Phase D — Scout UI

Goal: the page has a working control panel + readable result cards, adapted to shadcn/Tailwind style.

### Task D1: `ScoutControls` component

**Files:**
- Create: `resources/js/components/scout/ScoutControls.tsx`

- [ ] **Step 1: Create the component**

Create `resources/js/components/scout/ScoutControls.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type Props = {
    level: number;
    topN: number;
    max5Cost: number | null;
    roleBalance: boolean;
    isRunning: boolean;
    onLevelChange: (value: number) => void;
    onTopNChange: (value: number) => void;
    onMax5CostChange: (value: number | null) => void;
    onRoleBalanceChange: (value: boolean) => void;
    onRun: () => void;
};

export function ScoutControls({
    level,
    topN,
    max5Cost,
    roleBalance,
    isRunning,
    onLevelChange,
    onTopNChange,
    onMax5CostChange,
    onRoleBalanceChange,
    onRun,
}: Props) {
    return (
        <div className="flex flex-col gap-5 rounded-lg border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Scout Settings
            </h2>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Level</Label>
                    <span className="font-mono text-sm">{level}</span>
                </div>
                <Slider
                    value={[level]}
                    min={6}
                    max={10}
                    step={1}
                    onValueChange={([v]) => onLevelChange(v)}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Top results</Label>
                    <span className="font-mono text-sm">{topN}</span>
                </div>
                <Slider
                    value={[topN]}
                    min={5}
                    max={30}
                    step={5}
                    onValueChange={([v]) => onTopNChange(v)}
                />
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <Label>Max 5-cost</Label>
                    <span className="font-mono text-sm">
                        {max5Cost === null ? '∞' : max5Cost}
                    </span>
                </div>
                <Slider
                    value={[max5Cost ?? 5]}
                    min={0}
                    max={5}
                    step={1}
                    onValueChange={([v]) => onMax5CostChange(v === 5 ? null : v)}
                />
            </div>

            <div className="flex items-center justify-between">
                <Label htmlFor="role-balance">Role balance</Label>
                <Switch
                    id="role-balance"
                    checked={roleBalance}
                    onCheckedChange={onRoleBalanceChange}
                />
            </div>

            <Button onClick={onRun} disabled={isRunning} className="w-full">
                {isRunning ? 'Running…' : 'Run scout'}
            </Button>
        </div>
    );
}
```

- [ ] **Step 2: Verify shadcn primitives exist**

Run:
```bash
ls resources/js/components/ui/slider.tsx resources/js/components/ui/switch.tsx resources/js/components/ui/label.tsx resources/js/components/ui/button.tsx 2>&1
```

Expected: all four files exist. If `slider` or `switch` is missing, install via:
```bash
npx shadcn@latest add slider switch
```

- [ ] **Step 3: Commit**

```bash
git add resources/js/components/scout/ScoutControls.tsx
git commit -m "feat(scout): add ScoutControls component"
```

---

### Task D2: Champion / trait / emblem pickers

**Files:**
- Create: `resources/js/components/scout/LockedChampionsPicker.tsx`
- Create: `resources/js/components/scout/LockedTraitsPicker.tsx`
- Create: `resources/js/components/scout/EmblemPicker.tsx`

- [ ] **Step 1: Create `LockedChampionsPicker`**

Create `resources/js/components/scout/LockedChampionsPicker.tsx`:

```tsx
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Champion } from '@/workers/scout/types';

type Props = {
    champions: Champion[];
    locked: string[];
    onChange: (locked: string[]) => void;
};

export function LockedChampionsPicker({ champions, locked, onChange }: Props) {
    const [query, setQuery] = useState('');

    const filtered = champions
        .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 12);

    const toggle = (apiName: string) => {
        if (locked.includes(apiName)) {
            onChange(locked.filter((a) => a !== apiName));
        } else if (locked.length < 10) {
            onChange([...locked, apiName]);
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Locked champions ({locked.length}/10)
            </Label>
            <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
            />
            <div className="flex flex-wrap gap-1.5">
                {locked.map((apiName) => {
                    const champ = champions.find((c) => c.apiName === apiName);
                    if (!champ) return null;
                    return (
                        <Badge
                            key={apiName}
                            variant="default"
                            className="cursor-pointer gap-1"
                            onClick={() => toggle(apiName)}
                        >
                            <img
                                src={champ.icon}
                                alt=""
                                className="size-4 rounded-sm"
                            />
                            {champ.name}
                            <span className="ml-0.5 opacity-70">×</span>
                        </Badge>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {filtered.map((champ) => (
                    <Badge
                        key={champ.apiName}
                        variant={
                            locked.includes(champ.apiName) ? 'default' : 'outline'
                        }
                        className="cursor-pointer gap-1"
                        onClick={() => toggle(champ.apiName)}
                    >
                        <img
                            src={champ.icon}
                            alt=""
                            className="size-4 rounded-sm"
                        />
                        {champ.name}
                    </Badge>
                ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Create `LockedTraitsPicker`**

Create `resources/js/components/scout/LockedTraitsPicker.tsx`:

```tsx
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Trait } from '@/workers/scout/types';

type LockedTrait = { apiName: string; minUnits: number };

type Props = {
    traits: Trait[];
    locked: LockedTrait[];
    onChange: (locked: LockedTrait[]) => void;
};

export function LockedTraitsPicker({ traits, locked, onChange }: Props) {
    const [query, setQuery] = useState('');

    const filtered = traits
        .filter((t) => t.category === 'public')
        .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 15);

    const setMinUnits = (apiName: string, minUnits: number) => {
        const existing = locked.find((l) => l.apiName === apiName);
        if (!existing) {
            onChange([...locked, { apiName, minUnits }]);
        } else if (minUnits === 0) {
            onChange(locked.filter((l) => l.apiName !== apiName));
        } else {
            onChange(
                locked.map((l) =>
                    l.apiName === apiName ? { ...l, minUnits } : l,
                ),
            );
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Locked traits ({locked.length})
            </Label>
            <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search traits…"
            />
            <div className="flex flex-col gap-1.5">
                {filtered.map((trait) => {
                    const lockedEntry = locked.find(
                        (l) => l.apiName === trait.apiName,
                    );
                    return (
                        <div
                            key={trait.apiName}
                            className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                        >
                            <span className="flex items-center gap-2">
                                <img
                                    src={trait.icon}
                                    alt=""
                                    className="size-5"
                                />
                                {trait.name}
                            </span>
                            <div className="flex gap-1">
                                {trait.breakpoints.map((bp) => (
                                    <Badge
                                        key={bp.position}
                                        variant={
                                            lockedEntry?.minUnits === bp.minUnits
                                                ? 'default'
                                                : 'outline'
                                        }
                                        className="cursor-pointer"
                                        onClick={() =>
                                            setMinUnits(
                                                trait.apiName,
                                                lockedEntry?.minUnits === bp.minUnits
                                                    ? 0
                                                    : bp.minUnits,
                                            )
                                        }
                                    >
                                        {bp.minUnits}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Create `EmblemPicker`**

Create `resources/js/components/scout/EmblemPicker.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { Trait } from '@/workers/scout/types';

type EmblemEntry = { apiName: string; count: number };

type Props = {
    traits: Trait[];
    emblems: EmblemEntry[];
    onChange: (emblems: EmblemEntry[]) => void;
};

export function EmblemPicker({ traits, emblems, onChange }: Props) {
    const setCount = (apiName: string, count: number) => {
        if (count <= 0) {
            onChange(emblems.filter((e) => e.apiName !== apiName));
            return;
        }
        const existing = emblems.find((e) => e.apiName === apiName);
        if (existing) {
            onChange(
                emblems.map((e) =>
                    e.apiName === apiName ? { ...e, count } : e,
                ),
            );
        } else {
            onChange([...emblems, { apiName, count }]);
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Emblems ({emblems.reduce((n, e) => n + e.count, 0)})
            </Label>
            <div className="flex flex-wrap gap-1.5">
                {emblems.map((entry) => {
                    const trait = traits.find(
                        (t) => t.apiName === entry.apiName,
                    );
                    if (!trait) return null;
                    return (
                        <Badge
                            key={entry.apiName}
                            variant="default"
                            className="gap-1"
                        >
                            <img
                                src={trait.icon}
                                alt=""
                                className="size-4"
                            />
                            {trait.name} ×{entry.count}
                            <button
                                type="button"
                                className="ml-1 opacity-70"
                                onClick={() =>
                                    setCount(entry.apiName, entry.count - 1)
                                }
                            >
                                −
                            </button>
                            <button
                                type="button"
                                className="opacity-70"
                                onClick={() =>
                                    setCount(entry.apiName, entry.count + 1)
                                }
                            >
                                +
                            </button>
                        </Badge>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-1">
                {traits
                    .filter((t) => t.category === 'public')
                    .slice(0, 20)
                    .map((trait) => (
                        <Button
                            key={trait.apiName}
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => setCount(trait.apiName, 1)}
                        >
                            <img
                                src={trait.icon}
                                alt=""
                                className="size-4"
                            />
                            {trait.name}
                        </Button>
                    ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Commit**

```bash
git add resources/js/components/scout/LockedChampionsPicker.tsx resources/js/components/scout/LockedTraitsPicker.tsx resources/js/components/scout/EmblemPicker.tsx
git commit -m "feat(scout): add lock + emblem picker components"
```

---

### Task D3: Result card + list

**Files:**
- Create: `resources/js/components/scout/ScoutCompCard.tsx`
- Create: `resources/js/components/scout/ScoutResultsList.tsx`

- [ ] **Step 1: Create `ScoutCompCard`**

Create `resources/js/components/scout/ScoutCompCard.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ScoredTeam } from '@/workers/scout/types';

const COST_BORDER: Record<number, string> = {
    1: 'border-zinc-500',
    2: 'border-green-500',
    3: 'border-blue-500',
    4: 'border-purple-500',
    5: 'border-yellow-500',
};

const STYLE_CHIP: Record<string, string> = {
    Bronze: 'border-amber-700 bg-amber-950/40 text-amber-400',
    Silver: 'border-zinc-400 bg-zinc-800/60 text-zinc-200',
    Gold: 'border-yellow-500 bg-yellow-950/40 text-yellow-300',
    Prismatic: 'border-fuchsia-400 bg-fuchsia-950/40 text-fuchsia-300',
    Unique: 'border-red-500 bg-red-950/40 text-red-300',
};

type Props = {
    team: ScoredTeam;
};

export function ScoutCompCard({ team }: Props) {
    return (
        <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Score
                </span>
                <span className="font-mono text-lg font-bold text-amber-300">
                    {team.score.toFixed(1)}
                </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {team.champions.map((c) => (
                    <div
                        key={c.apiName}
                        className={cn(
                            'flex size-12 items-center justify-center overflow-hidden rounded border-2 bg-muted',
                            COST_BORDER[c.cost] ?? 'border-zinc-500',
                        )}
                        title={c.name}
                    >
                        <img
                            src={c.icon}
                            alt={c.name}
                            className="size-full object-cover"
                            loading="lazy"
                        />
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap gap-1">
                {team.activeTraits.map((t) => {
                    const style = t.style ?? 'Bronze';
                    return (
                        <Badge
                            key={t.apiName}
                            variant="outline"
                            className={cn(
                                'gap-1 text-[10px]',
                                STYLE_CHIP[style] ?? '',
                            )}
                        >
                            {t.icon && (
                                <img
                                    src={t.icon}
                                    alt=""
                                    className="size-3"
                                />
                            )}
                            {t.count} {t.name}
                        </Badge>
                    );
                })}
            </div>
        </Card>
    );
}
```

- [ ] **Step 2: Create `ScoutResultsList`**

Create `resources/js/components/scout/ScoutResultsList.tsx`:

```tsx
import { ScoutCompCard } from './ScoutCompCard';
import type { ScoredTeam } from '@/workers/scout/types';

type Props = {
    teams: ScoredTeam[];
    isRunning: boolean;
    error: string | null;
};

export function ScoutResultsList({ teams, isRunning, error }: Props) {
    if (error) {
        return (
            <div className="rounded-lg border border-red-800/60 bg-red-950/20 p-4 text-sm text-red-300">
                Scout failed: {error}
            </div>
        );
    }

    if (isRunning && teams.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Running scout…
            </div>
        );
    }

    if (teams.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No comps yet. Adjust settings and click "Run scout".
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {teams.map((team, i) => (
                <ScoutCompCard key={i} team={team} />
            ))}
        </div>
    );
}
```

- [ ] **Step 3: Commit**

```bash
git add resources/js/components/scout/ScoutCompCard.tsx resources/js/components/scout/ScoutResultsList.tsx
git commit -m "feat(scout): add result card + list components"
```

---

### Task D4: Full `Scout/Index.tsx` layout

**Files:**
- Modify: `resources/js/pages/Scout/Index.tsx`

- [ ] **Step 1: Replace the stub with the full page**

Replace `resources/js/pages/Scout/Index.tsx` with:

```tsx
import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { EmblemPicker } from '@/components/scout/EmblemPicker';
import { LockedChampionsPicker } from '@/components/scout/LockedChampionsPicker';
import { LockedTraitsPicker } from '@/components/scout/LockedTraitsPicker';
import { ScoutControls } from '@/components/scout/ScoutControls';
import { ScoutResultsList } from '@/components/scout/ScoutResultsList';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import type { Champion, ScoredTeam, ScoutContext, Trait } from '@/workers/scout/types';

type Props = {
    setNumber: number;
};

type EmblemEntry = { apiName: string; count: number };
type LockedTrait = { apiName: string; minUnits: number };

export default function ScoutIndex({ setNumber }: Props) {
    const { generate } = useScoutWorker();

    // Context is fetched once from the same /api/scout/context the worker
    // hits — lets the UI render pickers before the first generate call.
    const [champions, setChampions] = useState<Champion[]>([]);
    const [traits, setTraits] = useState<Trait[]>([]);

    useEffect(() => {
        fetch('/api/scout/context')
            .then((res) => res.json() as Promise<ScoutContext>)
            .then((ctx) => {
                setChampions(ctx.champions);
                setTraits(ctx.traits);
            });
    }, []);

    const [level, setLevel] = useState(8);
    const [topN, setTopN] = useState(10);
    const [max5Cost, setMax5Cost] = useState<number | null>(null);
    const [roleBalance, setRoleBalance] = useState(true);
    const [lockedChampions, setLockedChampions] = useState<string[]>([]);
    const [lockedTraits, setLockedTraits] = useState<LockedTrait[]>([]);
    const [emblems, setEmblems] = useState<EmblemEntry[]>([]);

    const [results, setResults] = useState<ScoredTeam[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(() => {
        setIsRunning(true);
        setError(null);
        generate({
            level,
            topN,
            max5Cost,
            roleBalance,
            lockedChampions,
            lockedTraits,
            emblems,
        })
            .then((out) => {
                setResults(out.results);
                setIsRunning(false);
            })
            .catch((err) => {
                setError(err.message);
                setIsRunning(false);
            });
    }, [generate, level, topN, max5Cost, roleBalance, lockedChampions, lockedTraits, emblems]);

    // Auto-run on first context load.
    useEffect(() => {
        if (champions.length > 0 && results.length === 0) {
            run();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [champions.length]);

    return (
        <>
            <Head title="Scout — TFT Scout" />
            <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[280px_1fr_300px]">
                <aside className="flex flex-col gap-4">
                    <ScoutControls
                        level={level}
                        topN={topN}
                        max5Cost={max5Cost}
                        roleBalance={roleBalance}
                        isRunning={isRunning}
                        onLevelChange={setLevel}
                        onTopNChange={setTopN}
                        onMax5CostChange={setMax5Cost}
                        onRoleBalanceChange={setRoleBalance}
                        onRun={run}
                    />
                </aside>

                <main className="flex flex-col gap-4">
                    <div className="flex items-baseline justify-between">
                        <h1 className="text-2xl font-bold">
                            Scout (Set {setNumber})
                        </h1>
                        <span className="text-xs text-muted-foreground">
                            {results.length} comps
                        </span>
                    </div>
                    <ScoutResultsList
                        teams={results}
                        isRunning={isRunning}
                        error={error}
                    />
                </main>

                <aside className="flex flex-col gap-4">
                    <LockedChampionsPicker
                        champions={champions}
                        locked={lockedChampions}
                        onChange={setLockedChampions}
                    />
                    <LockedTraitsPicker
                        traits={traits}
                        locked={lockedTraits}
                        onChange={setLockedTraits}
                    />
                    <EmblemPicker
                        traits={traits}
                        emblems={emblems}
                        onChange={setEmblems}
                    />
                </aside>
            </div>
        </>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'Scout', href: '/scout' }]}>
        {page}
    </AppLayout>
);
```

- [ ] **Step 2: Smoke test**

Navigate to `http://tft-scout.test/scout`. Expected:
- 3-column layout renders
- "Running scout…" shows briefly, then a grid of comp cards
- Locking a champion in the right sidebar updates the auto-run next time "Run scout" is clicked
- No TypeScript/runtime errors in the console

- [ ] **Step 3: Commit**

```bash
git add resources/js/pages/Scout/Index.tsx
git commit -m "feat(scout): assemble full Scout/Index layout with pickers"
```

---

### Task D5: Sidebar nav entry

**Files:**
- Modify: the nav component (usually `resources/js/layouts/app/*-sidebar.tsx` or `resources/js/layouts/app-layout.tsx`)

- [ ] **Step 1: Find the nav component**

Run:
```bash
grep -rln "href.*champions\|champions\.index" resources/js/layouts/ resources/js/components/ 2>&1 | head
```

Expected: path(s) to the file with the main sidebar nav list. Open it.

- [ ] **Step 2: Add a Scout nav item**

Add an entry matching the existing pattern (pick icon from lucide-react, e.g., `Compass` or `Radar`). Example inline addition:

```tsx
import { Radar } from 'lucide-react';

// ... inside the navigation array or JSX:
{ title: 'Scout', href: '/scout', icon: Radar }
```

Place it near "Champions" so it lives under the browse section.

- [ ] **Step 3: Manual check**

Refresh the app — the sidebar should show "Scout" and clicking it routes to `/scout`.

- [ ] **Step 4: Commit**

```bash
git add resources/js/layouts/
git commit -m "feat(scout): add Scout entry to sidebar nav"
```

**Gate — end of Phase D.** `/scout` page has controls, pickers, results. User can lock champions, change level, click Run, see new comps.

---

## Phase E — Polish

Goal: debouncing, loading states, stale indicator, error surfaces.

### Task E1: Debounced auto-run + stale banner

**Files:**
- Modify: `resources/js/pages/Scout/Index.tsx`

- [ ] **Step 1: Add a 300ms debounce on param changes**

Replace the manual run + locked-trait-aware auto-run with a debounced effect. Add this hook helper at the top of the file (above the component):

```tsx
function useDebounced<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);
    return debounced;
}
```

Then inside the component replace the single-shot auto-run effect with:

```tsx
const debouncedParams = useDebounced(
    { level, topN, max5Cost, roleBalance, lockedChampions, lockedTraits, emblems },
    300,
);

useEffect(() => {
    if (champions.length === 0) return;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [debouncedParams, champions.length]);
```

The manual "Run scout" button stays — it triggers `run()` immediately without waiting for debounce.

- [ ] **Step 2: Add a stale indicator**

Add state for the context response and read `stale`:

```tsx
const [contextStale, setContextStale] = useState(false);

useEffect(() => {
    fetch('/api/scout/context')
        .then((res) => res.json() as Promise<ScoutContext>)
        .then((ctx) => {
            setChampions(ctx.champions);
            setTraits(ctx.traits);
            setContextStale(ctx.stale);
        });
}, []);
```

Render a banner above the results when stale:

```tsx
{contextStale && (
    <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-300">
        MetaTFT data is older than 24h — a background refresh has been
        scheduled. Reload the page in a minute to see fresh numbers.
    </div>
)}
```

Place it right above `<ScoutResultsList …/>`.

- [ ] **Step 3: Smoke test**

Interact with the sliders — the results grid should update ~300ms after the last change, not on every frame. The "Run scout" button still triggers an instant run.

- [ ] **Step 4: Commit**

```bash
git add resources/js/pages/Scout/Index.tsx
git commit -m "feat(scout): debounce param changes + stale data banner"
```

---

### Task E2: Final manual parity check against legacy

**Files:** none

- [ ] **Step 1: Compare top-5 comps against legacy (if available)**

If the legacy app is still runnable (`cd legacy/tft-generator && ...`), start it on the same database snapshot and run scout with:
- level 8
- topN 10
- no locks, no emblems
- roleBalance on

Compare the top 5 comp apiName sets against the new app. Expected: same or near-same comps in slightly different order (seed-dependent). Different comps in top 5 → regression; bisect which ported file changed behavior.

If legacy is not runnable, do a sanity pass on new results instead:
- Each comp has exactly `level` champions (e.g. 8 at level 8)
- Active traits all have a valid breakpoint style
- Locking a champion → every returned comp includes that champion
- Locking trait "Challenger 4" → every returned comp shows Challenger with count ≥4

- [ ] **Step 2: Document any known discrepancies**

If behaviour diverges from legacy in a non-regression way (e.g., new scout ranks X higher because schema now exposes variant Y that legacy didn't know about), add a note at the bottom of `docs/superpowers/specs/2026-04-13-scout-port-design.md` under a new "Known deltas vs legacy" section.

- [ ] **Step 3: Final commit**

If any fixes landed from the parity check:

```bash
git add -A
git commit -m "fix(scout): parity adjustments after legacy comparison"
```

If no fixes needed, skip the commit — the plan is done.

**Gate — end of Phase E.** Scout is feature-complete per the MVP spec. Post-MVP work (transitions, road-to, insights panel, MetaTFT import scheduling) is tracked elsewhere.

---

## Self-review checklist (run after plan is written)

- [x] **Spec coverage:** every spec section has at least one task
  - MetaTFT sync → Phase A
  - Bundle/context endpoint → Phase B
  - Worker infra → Phase C (C1, C7, C8)
  - Algorithm port → Phase C (C2–C6)
  - UI (adapted to shadcn) → Phase D
  - Debouncing + stale → Phase E
  - Testing strategy (one PHPUnit test + manual smoke) → B3 + D4/D5 + E2

- [x] **Placeholder scan:** no TBD/TODO. One note in A4 Step 2 about verifying base URL — it's an explicit discovery step, not a placeholder.

- [x] **Type consistency:** `ScoredTeam` / `ScoutContext` / `ScoutParams` shape matches across types.ts, worker index, hook, and page. Worker message protocol (`{type, id, params}` / `{id, result|error}`) is consistent between C7 and C8.

- [x] **Ambiguity:** Phase C ports use the same "copy → fix imports → type check → commit" pattern. Each port task is interchangeable in structure so execution is mechanical.

Known gaps in the plan that are intentional (not plan failures):
- Exact MetaTFT API URL + payload shapes are recovered in A1 (a task), not assumed up-front.
- No unit tests for the algorithm port — spec decision #6.
- `roadTo` is stubbed out — spec non-goal.
