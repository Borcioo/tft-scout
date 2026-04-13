# Pre-Computed Hybrid Scout — Design Spec

## Problem

Scout algorytm trwa 5-10 sekund per request z powodu kombinacyjnej eksplozji:
- 3 pass'y (primary, drop-one, trait-seeded) = ~2000 iteracji `generateTeams`
- Każda iteracja: greedy build + local search = ~156k score calculations
- Zero caching — statyczne dane ładowane od nowa przy każdym request'cie

## Rozwiązanie

Hybrydowe podejście: pre-compute top kombinacji champów offline, query + lekki re-score real-time.

## Architektura

```
OFFLINE (ręczny skrypt, ~20 min)
┌─────────────────────────────────────┐
│  generate-precomp.js                │
│                                     │
│  1. Załaduj champions, traits, meta │
│  2. Dla team_size 5→13:             │
│     - Generuj compy (stochastic)    │
│     - BEZ cost penalty (neutral)    │
│     - Pruning: zachowaj top N       │
│     - Zapisz do precomp_teams       │
│  3. Linkuj drzewo (parent→child)    │
│  4. Buduj inverted index            │
└─────────────────────────────────────┘
         │ zapisuje do tft.db
         ▼
┌─────────────────────────────────────┐
│  tft.db (SQLite, plik na dysku)     │
│                                     │
│  precomp_teams        ~130k rows    │
│  precomp_champ_index  ~800k rows    │
└─────────────────────────────────────┘
         │ query przy request
         ▼
REAL-TIME (scout request od gracza)
┌─────────────────────────────────────┐
│  scout-v2.js (~10ms per request)    │
│                                     │
│  1. Query overlap z early units     │
│  2. Re-score z emblems/level/filters│
│  3. Local search (1 runda, top 5)   │
│  4. Traverse drzewo → transitions   │
│  5. Fallback → stary scout          │
└─────────────────────────────────────┘
```

## Kontekst projektu

- Aplikacja desktopowa (Electron/Node) dla 1-kilku graczy, nie publiczny serwer
- Re-generacja manualna (skrypt odpalany ręcznie po patchu / refreshu MetaTFT)
- 65 championów, 44 traity w obecnym secie (Set 17)
- Istniejący stack: Express + SQLite (better-sqlite3) + React

## Schema bazy danych

```sql
CREATE TABLE precomp_teams (
    id         INTEGER PRIMARY KEY,
    parent_id  INTEGER REFERENCES precomp_teams(id),
    team_size  INTEGER NOT NULL,
    champs     TEXT NOT NULL,       -- posortowane champion IDs: "3,8,17,23,42,51,61"
    traits     TEXT NOT NULL,       -- aktywne traity: "DarkStar,Bulwark,Bastion"
    base_score REAL NOT NULL,       -- score BEZ cost penalty
    add_champ  INTEGER              -- champion ID dodany vs parent
);

CREATE TABLE precomp_champ_index (
    champ_id  INTEGER NOT NULL,
    team_id   INTEGER NOT NULL REFERENCES precomp_teams(id),
    PRIMARY KEY (champ_id, team_id)
);

CREATE INDEX idx_size_score ON precomp_teams(team_size, base_score DESC);
CREATE INDEX idx_parent ON precomp_teams(parent_id);
```

## Generowanie offline (generate-precomp.js)

### Flow

1. Załaduj dane z tft.db (champions, traits, breakpoints, metatft ratings)
2. Dla team_size 5 → 13:
   - Użyj istniejącego algorytmu stochastic (greedyBuild + localSearch)
   - BEZ cost penalty (base_score neutralny — cost penalty w re-scorze)
   - BEZ locked units (generuj ogólne compy)
   - Iterations skalowane z team_size (więcej iteracji = lepsze pokrycie)
   - Deduplikacja po posortowanych champ IDs
   - Zachowaj top N per team_size
3. Linkowanie parent→child:
   - Dla compa team_size N, znajdź comp team_size N-1 z max overlap
   - Ustaw parent_id, add_champ
4. Buduj inverted index (champ_id → team_id)
5. ANALYZE (odśwież statystyki SQLite)

### Limity per team_size

```
team_size 5:   top 5,000
team_size 6:   top 10,000
team_size 7:   top 20,000
team_size 8:   top 30,000
team_size 9:   top 30,000
team_size 10:  top 20,000
team_size 11:  top 10,000
team_size 12:  top 5,000
team_size 13:  top 2,000
TOTAL:         ~132,000 compów, ~130 MB na dysku
```

### Re-generacja

```bash
node generate-precomp.js --regenerate
```

DROP + CREATE od nowa. Żadnej inkrementalnej logiki. ~20 min, raz na patch.

## Real-time scout-v2

### Parametry wejściowe (identyczne jak stary scout)

```javascript
{
  earlyUnits: string[],      // apiNames champów na boardzie
  currentLevel: number,       // level gracza (5-10)
  bonusSlots: number,          // dodatkowe sloty z itemów
  emblems: string[],           // trait emblem'y
  lockedTraits: string[],      // user constraints
  excludedTraits: string[],    // traits do pominięcia
  max5Cost: number|null        // max 5-cost champów
}
```

### Flow (6 kroków)

**Krok 1 — Query po early units:**
```
team_size = currentLevel + bonusSlots

Query 1: compy zawierające ALL early units     → ~50 wyników
Query 2: compy zawierające EACH early unit     → ~100 wyników per unit
Query 3: top compy po base_score (fallback)    → ~50 wyników
```

Przykład SQL:
```sql
SELECT t.* FROM precomp_teams t
JOIN precomp_champ_index i1 ON i1.team_id = t.id AND i1.champ_id = ?
JOIN precomp_champ_index i2 ON i2.team_id = t.id AND i2.champ_id = ?
WHERE t.team_size = ?
ORDER BY t.base_score DESC
LIMIT 50
```

**Krok 2 — Deduplikacja + ranking overlap:**
Merge wyników, posortuj po: `overlap_count * 10 + base_score`. Top 50 kandydatów.

**Krok 3 — Re-score z kontekstem gracza:**
Dla każdego z 50 kandydatów:
- Cost penalty dla konkretnego level (shop odds)
- Emblem bonus (trait count +1 per emblem)
- Excluded traits penalty
- Locked traits bonus/penalty
- Max 5-cost cap

**Krok 4 — Lekki local search (opcjonalny):**
Dla top 5 compów: 1 runda swapów (zamień 1 champa). Max 100 evaluations.

**Krok 5 — Transition'y z drzewa:**
Traverse parent_id w dół (skąd gracz idzie) i children w górę (dokąd zmierza).
Re-score każdy level z odpowiednim cost penalty.

**Krok 6 — Format response (identyczny jak stary scout).**

### Bonus sloty

Bonus sloty to stały modyfikator: `team_size = level + bonusSlots`.
Nie mnożą danych w bazie. Wpływają na:
1. Jaki `team_size` query'ujemy
2. Jaki `level` używamy do cost penalty w re-scorze

Przykład: level 5 + bonus 3 = query team_size 8, cost penalty z shop odds level 5.

### Fallback

```javascript
const count = db.prepare('SELECT COUNT(*) as c FROM precomp_teams').get().c;
if (count === 0) return oldScout(req, res);  // tabele puste

const results = scoutV2(db, params);
if (results.directions.length === 0) return oldScout(req, res);  // zero match'y
```

### Szacowany czas

```
Krok 1: 4 query SQL        ~2ms
Krok 2: sort 300 wyników   ~0.1ms
Krok 3: re-score 50 compów ~1ms
Krok 4: 100 swap eval      ~5ms
Krok 5: 5× tree traversal  ~2ms
Krok 6: format             ~1ms
TOTAL:                      ~10ms (vs 5-10s teraz = 500-1000× szybciej)
```

## Routing

```
POST /api/scout      → stary algorytm (bez zmian, fallback)
POST /api/scout-v2   → nowy hybrid
```

Frontend próbuje scout-v2, fallback na /api/scout.

## Ograniczenia i ryzyka

1. **Pokrycie** — stochastic sampling nie gwarantuje znalezienia wszystkich dobrych compów. Mitygacja: duża ilość iteracji offline + fallback na stary scout.
2. **Stale data** — po patchu pre-computed dane mogą być nieaktualne. Mitygacja: ręczna re-generacja.
3. **Drzewo parent linkage** — idealny parent (dokładny podzbiór) może nie istnieć w bazie. Mitygacja: bierzemy najlepszy overlap.
4. **Emblematy** — nie są w pre-compute, tylko w re-scorze. Comp z emblemem mógłby mieć inną strukturę. Mitygacja: local search w kroku 4 może swapnąć champa żeby lepiej wykorzystać emblem.
