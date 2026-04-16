# tft-scout — Claude context

Laravel 13 + Inertia + React + Postgres 18 scout tool dla TFT. Migracja z Node stack (2026-04-12); stary kod w `legacy/` — tylko referencyjnie, nie edytować.

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Vite production build
npm run build:ssr     # Vite + SSR build
npm run lint          # ESLint --fix
npm run lint:check    # ESLint (no fix)
npm run types:check   # tsc --noEmit
npm run format        # Prettier resources/
npm run scout         # tsx scripts/scout-cli.ts  (scout debug CLI)
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
- `docs/research/` — raporty: tft-data-sources, tft-hash-discovery, tft-character-bins-mechanics, debugging-ability-data
- `docs/champion-ability-pipeline.md` — end-to-end walkthrough (reference doc)
- `legacy/` — stary Node stack, nie edytować
- `tests/` — PHPUnit (phpunit.xml)

## Gotchas

- **Scout core MUSI być pure** — żadnych DB calls; mappery tylko na granicach (boundary)
- **TFT data source = CommunityDragon**, NIE Data Dragon (patrz `docs/research/tft-data-sources.md`)
- **Character bins path**: `game/characters/*.cdtb.bin.json` (nieoczywiste!)
- **Variant mechanics**: `_traitclone` records, FNV1a resolver
- **Hash resolution**: BIN = FNV1a-32 lowercase, RST = xxh3_64 lowercase & mask(38) dla TFT17
- **Ability descriptions**: plaintext RST keys w `SpellObject.mClientData`
- **Locked traits = HARD filter** (nie tylko score penalty); **trap traits penalized**; **no sell-all comps**
- **Post-R refactor** — każdy change w `synergy-graph/` musi przejść baseline-diff gate (patrz `scripts/refactor-R-checkpoint.sh`)
- **Correctness first** — bugi/behavior > optymalizacje/refactor/cleanup (user decision 2026-04-14)
- **Perf target** — po Phase C: locked ~700ms, non-lock ~1.7s (201ms gap do zamknięcia)
- **pnpm-workspace.yaml istnieje**, ale scripts używają `npm` — sprawdź który package manager zanim zainstalujesz deps

## Debug workflows

- **Scout algorithm debug** → skill `scout-cli-debug` (CLI odpala real worker z kontrolowanymi inputami, JSON output)
- **Batch analysis across runs** → skill `scout-lab` (SQLite sidecar w `tmp/scout-lab/runs.db`)
- **Ability data issues** → `docs/research/debugging-ability-data.md` (symptom → layer triage)

## Workflow norms

- Batchuj małe zmiany w commitach — nie commituj per tweak
- Nie pytaj "continue or stop?" bez konkretnego powodu — user decyduje kiedy dość
- Auto-memory (`~/.claude/projects/D--Herd-tft-scout/memory/`) trzyma sesyjny kontekst; ten plik = stabilny project contract
