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
  - `engine.ts`, `strength.ts`, `scorer.ts`, `polish.ts`, `candidates.ts`, `re-score.ts`, `insights.ts`, `hero-exclusion.ts`
- `scripts/scout-cli/` — debug CLI (commands/, lab/, lookup, params, context, format)
- `scripts/scout-cli.ts` — entry point (`npm run scout`)
- `scripts/scout-audit/` — batch analysis
- `docs/research/` — raporty: tft-data-sources, tft-hash-discovery, tft-character-bins-mechanics, debugging-ability-data, set18-data-shape, scout-strength-model, scout-discovery
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
- **MetaTFT = jeden patch na sync** (`MetaTftClient::resolvePatch`): najnowszy z ≥300k gier w oknie 2 dni, inaczej poprzedni (np. 18.4b zamiast świeżego 18.5); `patch=X&b_patch=Y` na wszystkich endpointach, bez auto-poszerzania rangi. `patch=current` mieszał patche i dawał próbki po kilka tys. gier
- **Set 18 role są inferowane** (`RoleInferenceHook`) — Riot nie wystawia ról; heurystyka, nie prawda
- **Kha'Zix = 16 wpisów** (base + 15 kombinacji ewolucji, `sets.18.evolutions`); komplet 4 jest `lockOnly` (scout bierze tylko po locku), a Rival u niego jest w `unscoredTraits` (aktywny, widoczny, bez punktów). Zmiana logiki importu → podbij `TFT_DATA_REVISION` w `deploy.yml`, inaczej prod nie re-importuje
- **Locked traits = HARD filter** (nie tylko score penalty); **trap traits penalized**; **no sell-all comps**
- **Level gate = HARD** (`MIN_LEVEL_BY_COST`: 4-cost od lvl 7, 5-cost od lvl 9 — próg ~10% szans w sklepie); omija go tylko jawny lock championa, nigdy auto-promocja z locka cechy (user decision 2026-10-21)
- **Post-R refactor** — każdy change w `synergy-graph/` musi przejść baseline-diff gate (patrz `scripts/refactor-R-checkpoint.sh`; scenariusze Set 18, baseline po zmianie setu: `--capture` na kodzie sprzed zmiany)
- **Correctness first** — bugi/behavior > optymalizacje/refactor/cleanup (user decision 2026-04-14)
- **Perf target** — po Phase C (Set 17): locked ~700ms, non-lock ~1.7s; Set 18 snapshot w kontenerze CI-like: non-lock lvl 8 ~3.3–4.3s także na kodzie sprzed zmian (większa pula), locked ~1.5s; engine v2 w tym samym kontenerze co main: lvl 8 2.3s vs 4.3s, lvl 9 3.6s vs 7.2s, Vanguard 6 lock 1.6s vs 2.3s (indeks strength.ts zagnieżdżony per unit — bez string kluczy per para)
- **Scoring = model siły planszy** (`strength.ts`, `docs/research/scout-strength-model.md`) — MetaTFT unit/para/trait-level lifts; meta compy to TYLKO zbiór testowy (`npm run scout -- eval`, offline na zamrożonym `tmp/scout-eval/`), nigdy cel ani bonus za podobieństwo. Surowe `place` rankuje (bywa < 1); w UI `breakdown.avgPlace` (kalibracja `STRENGTH.calibration`). Zmiana skali score → podbij `SCORE_MODEL` (config.ts), Plans porównuje tylko ten sam model
- **MetaTFT = nieoficjalne API, za dużo zapytań = ban** — narzędzia CLI pytają WYŁĄCZNIE przez `scripts/scout-cli/metatft-http.ts` (kopia odpowiedzi w `tmp/metatft-cache`, 1 zapytanie / 2 s, budżet 300 na uruchomienie i 600 na dzień, po przekroczeniu zapis postępu i stop); nigdy `curl` do MetaTFT bezpośrednio ani pętle bez cache; sync aplikacji idzie przez `metatft_cache` w DB. Dane do aplikacji = nasza kopia w DB odświeżana przyrostowo, przeglądarka nigdy nie pyta MetaTFT
- **MetaTFT dane do analiz** — zapisuj raz do `tmp/scout-eval/` i czytaj lokalnie (podsumowania, nie surowe JSON-y); nie pobieraj na świeżo przy każdej analizie. `npm run scout -- oracle` = realne wyniki konkretnych plansz z explorera (filtr `unit_tier_numitems_unique={api}-{kopia}_{gwiazdki}_{itemy}`, `/units_unique` zwraca wszystkie dopełnienia), wznawialne; `scout eval` czyta je automatycznie
- **Odkrywanie plansz** (`npm run scout -- discover`, `docs/research/scout-discovery.md`) — Bayes: model + Gold+ + Master+ (`oracle --rank`), ranking EI w warstwach (rozmiar × liczba 5-costów); `top-games` = Riot API (`RIOT_API_KEY`), zapisuje tylko plansze, bez identyfikatorów graczy
- **Set 18 nie ma liczb umiejętności w CDragon** (spelle: `DataValue`/`OtherValue`, kalkulacje zahashowane) — model "ze statystyk gry" nie zadziała; statystyki bazowe w obrębie kosztu nie przewidują siły (Riot balansuje je przeciw spellom)
- **pnpm-workspace.yaml istnieje**, ale scripts używają `npm` — sprawdź który package manager zanim zainstalujesz deps

## Debug workflows

- **Scout algorithm debug** → skill `scout-cli-debug` (CLI odpala real worker z kontrolowanymi inputami, JSON output)
- **Batch analysis across runs** → skill `scout-lab` (SQLite sidecar w `tmp/scout-lab/runs.db`)
- **Ability data issues** → `docs/research/debugging-ability-data.md` (symptom → layer triage)

## Workflow norms

- Batchuj małe zmiany w commitach — nie commituj per tweak
- Nie pytaj "continue or stop?" bez konkretnego powodu — user decyduje kiedy dość
- Auto-memory (`~/.claude/projects/D--Herd-tft-scout/memory/`) trzyma sesyjny kontekst; ten plik = stabilny project contract
