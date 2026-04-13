# TFT Team Generator — Specyfikacja

## Cel

Lokalne narzędzie desktopowe do generowania optymalnych kompozycji teamów w Teamfight Tactics (Set 17 "Space Gods"). Gracz podaje constraints (posiadani championowie, emblematy, pożądane traity, level) i otrzymuje listę najlepszych opcji teamów posortowaną po score synergii.

Narzędzie "for fun" — zero deploymentu, zero chmury, zero kont użytkowników.

## Stack technologiczny

| Warstwa | Technologia |
|---|---|
| Frontend | Vite + React + Tailwind CSS |
| Backend | Node.js + Express |
| Baza danych | SQLite |
| LLM | Ollama + Qwen3 8B (lokalnie) |
| Dane | Community Dragon PBE JSON |

## Źródło danych

### Community Dragon PBE

- URL: `https://CDRAGON_REDACTED/pbe/cdragon/tft/en_us.json`
- Polski: `https://CDRAGON_REDACTED/pbe/cdragon/tft/pl_pl.json`
- Zawartość: championowie (statystyki, traity, umiejętności), traity (breakpointy, efekty), itemy (receptury, efekty), augmenty
- ~23 MB JSON, aktualizowany przy każdym patchu

### Import danych

- Ręczny trigger: przycisk "Odśwież dane" w UI lub komenda `npm run import`
- Proces: fetch JSON z CDragon → parsowanie → upsert do SQLite
- Nie automatyczny — gracz odświeża kiedy wyjdzie nowy patch

### Tier lista

- Osobna tabela w SQLite
- Źródło: ręczny import lub scraping z MetaTFT/tactics.tools (do ustalenia)
- Wagi: S=10, A=8, B=6, C=4, D=2

## Model danych (SQLite)

### Tabela: champions

| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| apiName | TEXT UNIQUE | Np. "TFT17_Jhin" |
| name | TEXT | Np. "Jhin" |
| cost | INTEGER | 1-5 (koszt w złocie) |
| hp | REAL | Bazowe HP |
| armor | REAL | Bazowy armor |
| magicResist | REAL | Bazowy MR |
| attackDamage | REAL | Bazowe AD |
| attackSpeed | REAL | Bazowe AS |
| mana | REAL | Max mana |
| startMana | REAL | Startowa mana |
| range | REAL | Zasięg ataku |
| critChance | REAL | Szansa na crit |
| critMultiplier | REAL | Mnożnik crit |
| icon | TEXT | Ścieżka do ikony |
| abilityDesc | TEXT | Opis umiejętności |
| abilityStats | TEXT (JSON) | Zmienne umiejętności na gwiazdki |

### Tabela: traits

| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| apiName | TEXT UNIQUE | Np. "TFT17_Sniper" |
| name | TEXT | Np. "Sniper" |
| description | TEXT | Opis traitu |
| icon | TEXT | Ścieżka do ikony |

### Tabela: trait_breakpoints

| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| traitId | INTEGER FK | → traits.id |
| minUnits | INTEGER | Minimum jednostek do aktywacji |
| maxUnits | INTEGER | Maximum (do następnego progu) |
| style | INTEGER | 1=brąz, 3=srebro, 4=złoto, 5=pryzmat |
| effects | TEXT (JSON) | Zmienne efektów na tym progu |

### Tabela: champion_traits

| Kolumna | Typ | Opis |
|---|---|---|
| championId | INTEGER FK | → champions.id |
| traitId | INTEGER FK | → traits.id |

### Tabela: items

| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| apiName | TEXT UNIQUE | Np. "TFT_Item_RabadonsDeathcap" |
| name | TEXT | Np. "Rabadon's Deathcap" |
| component1 | TEXT | Komponent 1 (apiName) |
| component2 | TEXT | Komponent 2 (apiName) |
| effects | TEXT (JSON) | Efekty numeryczne |
| tags | TEXT (JSON) | Tagi kategoryzujące |
| isEmblem | BOOLEAN | Czy to emblemat |
| traitId | INTEGER FK NULL | → traits.id (jeśli emblemat) |
| icon | TEXT | Ścieżka do ikony |

### Tabela: tier_list

| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK | Auto-increment |
| championId | INTEGER FK | → champions.id |
| tier | TEXT | S/A/B/C/D |
| source | TEXT | Źródło (np. "metatft") |
| updatedAt | TEXT | Data aktualizacji |

## Scoring Engine

### Input (constraints)

```json
{
  "lockedChampions": ["TFT17_Jhin", "TFT17_Zed"],
  "lockedTraits": ["Sniper"],
  "emblems": ["DarkStar", "Mystic"],
  "level": 8,
  "excludedChampions": ["TFT17_Vex"]
}
```

### Algorytm: GRASP (Greedy Randomized Adaptive Search Procedure)

**Krok 1 — Filtracja kandydatów:**
1. Usuń excludedChampions
2. Usuń championów bez overlap z traitami lockedChampions + lockedTraits + emblems
3. Zachowaj championów z "własnymi" silnymi synergiami
4. Typowy wynik: 15-25 kandydatów

**Krok 2 — Generowanie teamów (N=1000 iteracji):**
1. Zacznij od lockedChampions
2. Przypisz emblematy do championów (optymalizuj)
3. Powtarzaj aż team pełny (level):
   - Dla każdego kandydata oblicz przyrost score
   - Dodaj najlepszego (z 20% szansą: 2. lub 3. najlepszego — dla różnorodności)
4. Local search: próbuj zamiany championów, akceptuj jeśli score rośnie
5. Zapisz team + score

**Krok 3 — Wyniki:**
- Deduplikacja teamów
- Sortowanie po score malejąco
- Zwróć top N (domyślnie 10)

### Funkcja scoringu

```
teamScore = sum(championScore) + sum(traitScore) + sum(emblemBonus)

championScore:
  tierWeight     = S:10, A:8, B:6, C:4, D:2 (z tier_list)
  costWeight     = cost * 2
  championScore  = tierWeight + costWeight

traitScore (per aktywny trait):
  style          = breakpoint style (brąz=1, srebro=3, złoto=5, pryzmat=8)
  traitScore     = style * (1 + 0.5 * nadmiarowi championowie powyżej progu)
  
  BONUS "prawie breakpoint":
  Jeśli brakuje 1 championa do następnego progu → +2 sygnał w UI

emblemBonus:
  Jeśli emblem podnosi trait do wyższego breakpointu → style_difference * 3
  Jeśli emblem nie zmienia breakpointu → +1
```

### Czego scoring celowo NIE robi (faza 1):

- Nie symuluje walki
- Nie ocenia pozycjonowania
- Nie liczy item-champion matchingu (faza 2)
- Nie uwzględnia augmentów (faza 2)

## UI Layout

### Desktop — 3 panele

```
┌──────────────────────┬────────────────────────────┐
│  FILTRY (lewy)       │  WYNIKI (prawy)            │
│                      │                            │
│  Level: [dropdown]   │  Team 1 — Score: 87        │
│  Championowie: [+]   │  [ikony championów]         │
│  Traity: [dropdown]  │  Aktywne traity + progi     │
│  Emblematy: [+]      │                            │
│  Wyklucz: [+]        │  Team 2 — Score: 82        │
│  [GENERUJ]           │  ...                       │
├──────────────────────┴────────────────────────────┤
│  AI CHAT (dolny, zwijany)                         │
│  > input użytkownika                              │
│  < odpowiedź AI + wyniki                          │
└───────────────────────────────────────────────────┘
```

### Interakcja:
- Filtry aktualizują wyniki na żywo (debounce 300ms)
- Championów/traity wybieramy z dropdown z wyszukiwaniem i ikonkami
- Wyniki pokazują: championów z ikonami, aktywne traity z breakpointami, score
- "Prawie breakpoint" oznaczony wizualnie (np. "3/4 Sniper — brakuje 1!")

## AI Chat (Ollama + Qwen3 8B)

### Rola

1. **NLU** — parsuje natural language na JSON constraints
2. **Prezenter** — komentuje wyniki scoring engine

### System prompt

```
Jesteś asystentem TFT Set 17 "Space Gods".

Twoja rola:
1. Parsuj zapytania gracza na constraints w formacie JSON
2. Odpowiadaj krótko — gracz może być w trakcie gry
3. Znasz wszystkich championów, traity i itemy Set 17

Format odpowiedzi: najpierw wyniki, potem krótki komentarz.
Jeśli nie rozumiesz zapytania, zapytaj.
```

### Flow

```
Frontend → POST /api/chat { message: "..." }
Backend:
  1. Wyślij do Ollama z system promptem + format: json_schema
  2. Ollama zwraca JSON constraints
  3. Backend odpala scoring engine
  4. Wyślij wyniki z powrotem do Ollama do sformatowania
Frontend ← { reply: "...", teams: [...], constraints: {...} }
```

### Model

- `qwen3:8b` przez Ollama
- Structured output: Ollama `format` parameter z JSON Schema
- Temperature: 0 (deterministyczne parsowanie)

## API Endpoints (Express)

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/champions` | GET | Lista championów z filtrami (cost, trait) |
| `/api/traits` | GET | Lista traitów z breakpointami |
| `/api/items` | GET | Lista itemów (opcjonalnie: tylko emblematy) |
| `/api/generate` | POST | Scoring engine — przyjmuje constraints, zwraca top N teamów |
| `/api/chat` | POST | AI chat — przyjmuje wiadomość, zwraca odpowiedź + teamy |
| `/api/import` | POST | Import danych z Community Dragon |

## Fazy rozwoju

### Faza 1 (MVP)
- Import danych z Community Dragon → SQLite
- Scoring engine (GRASP)
- UI z filtrami + wyniki
- AI chat z Ollama

### Faza 2 (rozszerzenia)
- Screenshot reader (OpenCV template matching → automatyczne constraints)
- Item-champion matching w scoringu
- Augmenty w scoringu
- Tier lista auto-import z zewnętrznych źródeł

## Wymagania środowiskowe

- Node.js 20+
- Ollama z modelem `qwen3:8b`
- ~5 GB RAM na model LLM
- Przeglądarka (Chrome/Firefox)
