# Legacy — tft-generator (Node/Express)

Kod referencyjny ze starego projektu `D:/Projekty/tft-generator/` przeniesiony tutaj jako źródło do portowania na Laravel + PostgreSQL.

**Zasady:**
- Nie modyfikować — to zamrożona referencja.
- Nie uruchamiać — nie ma tu `node_modules`, configów ani integracji z aktualną bazą.
- Używać jako czytanki przy porcie algorytmu i mapperów na PHP/Eloquent.

## Co jest gdzie

### `client/src/algorithm/` — **kanoniczna** wersja algorytmu
Po migracji client-side (plan `2026-04-08-client-side-algorithm.md`) to tutaj żyje aktualny algorytm scout/scoring. 8 plików, czysty JS bez zależności:
- `engine.js` — beam search, pętla główna generatora
- `synergy-graph.js` — graf synergii championów
- `scorer.js` — funkcja scoringu (trait breakpoints, koszty, item builds)
- `candidates.js` — generowanie kandydatów do beam
- `insights.js` — opis wyników
- `config.js` — wagi, stałe, tuning
- `active-traits.js` — ekstrakcja aktywnych traits z composu
- `re-score.js` — re-scoring zapisanych teamów

### `client/src/workers/` i `client/src/hooks/`
Kontekst użycia algorytmu (Web Worker + React hooks) — pokazuje kształt wejścia/wyjścia.

### `server/src/algorithm/` — starsza wersja
Sprzed migracji client-side. Użyteczne do porównania (`diff` z client/algorithm) żeby zobaczyć ewolucję.

### `server/src/mappers/`
DB → algorithm input. **Ważne przy porcie na Eloquent** — pokazuje jak surowe rekordy SQLite były formowane w strukturę czytaną przez `engine.js`.

### `server/src/services/`
Logika otaczająca scoring (cache, orchestration).

### `server/src/routes/`
Kształt API (`/api/scout`, `/api/scout/context`) — referencja przy projektowaniu Laravelowych kontrolerów.

### `server/src/db/`
Schema SQLite — porównanie z nowym schematem Postgres (`docs/schema-plan.md`).

## Powiązane dokumenty

- `docs/legacy/specs/` — projekty (design docs) algorytmu i feature'ów
- `docs/legacy/plans/` — plany implementacyjne (już wykonane w starym kodzie)
- `docs/knowledge-base/` — wiedza domenowa TFT (champions, traits, tierlisty)
- `docs/algorithm-overview.md` — ogólny przegląd algorytmu
