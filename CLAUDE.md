# tft-scout — Claude context

Laravel 13 + Inertia + React + Postgres 18 scout tool dla TFT. Migracja z Node stack (2026-04-12); stary kod w `legacy/` — tylko referencyjnie, nie edytować.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Vite production build
npm run build:ssr     # Vite + SSR build
npm run lint          # Biome check --write (lint + format + import order)
npm run lint:check    # Biome check, read-only (CI: `biome ci`)
npm run types:check   # tsc --noEmit (TypeScript 7, natywny kompilator)
npm run format        # Biome format --write
npm run scout         # tsx scripts/scout-cli.ts  (scout debug CLI)
npm test              # Vitest — resources/js/**/__tests__/*.test.ts (engine: workers/scout/__tests__, fixture mini-set.ts)
vendor/bin/pest --parallel   # Pest 5 (PHPUnit 13), needs Postgres DB `tftscout_test`
```

Laravel: `php artisan ...` (przez Herd wrapper — `source ~/.bashrc` jeśli fail). Herd serwuje pod `https://tft-scout.test` (self-signed cert; Node fetch wymaga `NODE_TLS_REJECT_UNAUTHORIZED=0`, curl `-k`). `localhost` zwraca 404.

## Architecture

- `app/` — Laravel (Actions, Http, Jobs, Models, Services, Console, Providers)
- `resources/js/` — Inertia + React frontend (`pages/`, `components/`, `hooks/`, `layouts/`, `lib/`)
- `resources/js/workers/scout/` — **pure TS scout algorithm** (no DB, mappers na granicach)
  - `synergy-graph/` — po refactor R: core/phases/shared layers, PhaseContext registry (post-2026-04-15)
  - `engine.ts`, `scorer.ts`, `candidates.ts`, `re-score.ts`, `insights.ts`, `hero-exclusion.ts`
- `scripts/scout-cli/` — debug CLI (commands/, lab/, lookup, params, context, format)
- `scripts/scout-cli.ts` — entry point (`npm run scout`)
- `scripts/scout-audit/` — batch analysis
- `docs/research/` — raporty: tft-data-sources, tft-hash-discovery, tft-character-bins-mechanics, debugging-ability-data, set18-data-shape
- `docs/knowledge-base/` — baza wiedzy aktualnego setu (Set 18; Set 17 w `set17/`)
- `docs/champion-ability-pipeline.md` — end-to-end walkthrough (reference doc)
- `legacy/` — stary Node stack, nie edytować
- `tests/` — Pest 5 (phpunit.xml → Postgres `tftscout_test`); stare klasy PHPUnit działają bez zmian, nowe testy w składni Pest
- `resources/js/**/__tests__/` — Vitest 5 (`vitest.config.ts`, osobno od `vite.config.ts`)

## Gotchas

- **Scout core MUSI być pure** — żadnych DB calls; mappery tylko na granicach (boundary)
- **TFT data source = CommunityDragon**, NIE Data Dragon (patrz `docs/research/tft-data-sources.md`)
- **Character bins path**: `game/characters/*.cdtb.bin.json` (nieoczywiste!)
- **Variant mechanics**: `_traitclone` records, FNV1a resolver
- **Hash resolution**: BIN = FNV1a-32 lowercase, RST = xxh3_64 lowercase & mask(38); stringtable ma dziś większość kluczy jako lowercase plaintext — zawsze `StringtableCache::find()`
- **Ability descriptions**: plaintext RST keys w `SpellObject.mClientData`
- **Set 18 = namespace `DA_`** (DA_18_Ahri, DA_Amumu18, DA_InfinityEdge) — nigdy nie zakładaj `TFT{N}_`; prefiksy i quirki setu w `config/tft.php` `sets` → `App\Support\SetProfile`
- **Trait amounts / team size są danymi**: `champion_trait.amount` (bin `mLinkedTraits[].Amount`: Lux ×2, Elder Dragon ×2) → worker `traitAmounts`; `breakpoint.teamSizeBonus` (Riftbeast 10 → +2) — bez hardkodów `TFT17_Mecha`
- **Set 18 role są inferowane** (`RoleInferenceHook`) — Riot nie wystawia ról; heurystyka, nie prawda
- **Locked traits = HARD filter** (nie tylko score penalty); **trap traits penalized**; **no sell-all comps**
- **Level gate = HARD** (`MIN_LEVEL_BY_COST`: 4-cost od lvl 7, 5-cost od lvl 9 — próg ~10% szans w sklepie); omija go tylko jawny lock championa, nigdy auto-promocja z locka cechy (user decision 2026-10-21)
- **Post-R refactor** — każdy change w `synergy-graph/` musi przejść baseline-diff gate (patrz `scripts/refactor-R-checkpoint.sh`; scenariusze Set 18, baseline po zmianie setu: `--capture` na kodzie sprzed zmiany)
- **Correctness first** — bugi/behavior > optymalizacje/refactor/cleanup (user decision 2026-04-14)
- **Perf target** — po Phase C (Set 17): locked ~700ms, non-lock ~1.7s; Set 18 snapshot w kontenerze CI-like: non-lock lvl 8 ~3.3s także na kodzie sprzed zmian (większa pula), locked ~1.5s
- **pnpm-workspace.yaml istnieje**, ale scripts używają `npm` — sprawdź który package manager zanim zainstalujesz deps

## Debug workflows

- **Scout algorithm debug** → skill `scout-cli-debug` (CLI odpala real worker z kontrolowanymi inputami, JSON output)
- **Batch analysis across runs** → skill `scout-lab` (SQLite sidecar w `tmp/scout-lab/runs.db`)
- **Ability data issues** → `docs/research/debugging-ability-data.md` (symptom → layer triage)

## Workflow norms

- Batchuj małe zmiany w commitach — nie commituj per tweak
- Nie pytaj "continue or stop?" bez konkretnego powodu — user decyduje kiedy dość
- Auto-memory (`~/.claude/projects/D--Herd-tft-scout/memory/`) trzyma sesyjny kontekst; ten plik = stabilny project contract
