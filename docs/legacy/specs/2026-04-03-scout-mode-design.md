# Scout Mode — Early Game Direction Finder

## Problem

Current generator answers "build the best comp around these champions." But in-game, players need the opposite: "I have these random early game units, what endgame comp should I build toward?"

## Solution

Add a "Scout directions" mode that takes early game units and suggests 2-3 endgame directions with keep/sell/add guidance per level.

## UI Changes

### Mode Toggle

Toggle at the top of FilterPanel: **"Build comp"** (existing) vs **"Scout directions"** (new).

In Scout mode:
- "My champions" label → "Early game board"
- "Generate" button → "Scout"
- Level means "target endgame level" (default 8)
- Other filters (emblems, Stargazer variant, excluded traits) remain available
- Max 5-cost filter remains available

### Results Display

Instead of a flat list of comps, show 2-3 direction cards:

```
Direction: Dark Star Carry (meta avg 3.32)
───────────────────────────────────────────
Endgame (lv8): Shen, Jhin, Blitzcrank, Mordekaiser, Bard, Rammus, Gnar, Vex
Score: 151

From your board:
  Keep: Mordekaiser, Talon → replace at lv7 with Jhin
  Sell: Cho'Gath (no synergy)
  Add: Shen (lv7), Jhin (lv8), Blitzcrank (lv8)

▸ Show level-by-level transitions
```

Each card is expandable to show transitions (reuses existing transitions logic).

## Backend

### New endpoint: `POST /api/scout`

#### Request
```json
{
  "earlyUnits": ["TFT17_ChoGath", "TFT17_Mordekaiser", "TFT17_Talon"],
  "targetLevel": 8,
  "emblems": [],
  "excludedTraits": [],
  "stargazerVariant": null,
  "max5Cost": null
}
```

#### Algorithm

1. **Collect trait affinity** from early units:
   - Count traits from all early units
   - Example: Cho'Gath (Dark Star, Brawler) + Mordekaiser (Vanguard, Dark Star, Conduit) + Talon (Rogue, Stargazer) → Dark Star: 2, Brawler: 1, Vanguard: 1, Conduit: 1, Rogue: 1, Stargazer: 1

2. **Identify candidate directions** — traits with:
   - 2+ units from early board, OR
   - MetaTFT trait rating score > 0.6 at any breakpoint AND at least 1 early unit contributes
   - Limit to top 4 candidate directions

3. **For each direction**, generate an endgame comp:
   - Lock the direction trait (e.g. Dark Star with minCount = first meaningful breakpoint)
   - Early units get a scoring bonus (not hard-locked — algorithm can drop them if better options exist)
   - Run `generateTeams()` with these modified constraints
   - Take the top result

4. **Build keep/sell/add analysis** for each direction:
   - For each early unit: is it in the endgame comp? → "keep"
   - If not in endgame but shares traits with it → "sell later" (note when it gets replaced)
   - If not in endgame and no trait overlap → "sell"
   - Champions in endgame but not in early → "add" with suggested level (based on cost + shop odds)

5. **Rank directions** by:
   - Endgame comp score (primary)
   - Number of early units kept (tiebreaker — more kept = smoother transition)
   - MetaTFT meta comp overlap (bonus info)

#### Response
```json
{
  "directions": [
    {
      "name": "Dark Star",
      "mainTrait": "TFT17_DarkStar",
      "metaAvgPlace": 3.32,
      "endgameComp": { /* standard team result object */ },
      "earlyAnalysis": {
        "keep": [
          { "apiName": "TFT17_Mordekaiser", "reason": "Dark Star + Vanguard core" }
        ],
        "sellLater": [
          { "apiName": "TFT17_Talon", "replacedBy": "TFT17_Jhin", "atLevel": 7, "reason": "upgrades Sniper + Eradicator" }
        ],
        "sell": [
          { "apiName": "TFT17_ChoGath", "reason": "no synergy with direction" }
        ],
        "add": [
          { "apiName": "TFT17_Shen", "atLevel": 7, "reason": "Bulwark unique" },
          { "apiName": "TFT17_Jhin", "atLevel": 8, "reason": "Dark Star carry" },
          { "apiName": "TFT17_Blitzcrank", "atLevel": 8, "reason": "Party Animal unique" }
        ]
      },
      "earlyUnitsKept": 1,
      "score": 151
    }
  ],
  "earlyTraitAffinity": {
    "TFT17_DarkStar": 2,
    "TFT17_HPTank": 1,
    "TFT17_ShieldTank": 1
  }
}
```

### Early unit scoring bonus

In the scout flow, when calling `generateTeams`, early units are NOT hard-locked. Instead, add a scoring bonus in `quickScore`:

```
For each early unit present in the team: +3 points
```

This makes the algorithm prefer keeping early units but allows dropping them if the comp is significantly better without them.

### "Add at level" estimation

Based on champion cost and shop odds:
- 1-2 cost: available from level 3+
- 3 cost: suggest level 6-7
- 4 cost: suggest level 7-8
- 5 cost: suggest level 8-9

### Direction naming

Use the locked trait name as direction name. If a meta comp matches (>50% overlap), append the meta comp name:
- "Dark Star" or "Dark Star (Dark Star + Rammus meta)"

## Frontend Components

### New: `ScoutResultCard.jsx`

Displays one direction. Props: `direction`, `onExpand` (for transitions).

Shows:
- Direction name + meta avg place
- Endgame comp (champion icons, like TeamCard)
- Keep/sell/add section with color coding (green keep, red sell, blue add)
- Expandable transitions section (reuses existing MiniTeam)

### Modified: `FilterPanel.jsx`

- Add `mode` state: `'build'` | `'scout'`
- Toggle at top of panel
- Labels change based on mode
- Calls `/api/scout` instead of `/api/generate` in scout mode

### Modified: `ResultsPanel.jsx`

- Accept `mode` prop
- If mode is `'scout'`: render ScoutResultCard list instead of TeamCard list

### i18n additions

```
'mode.build': 'Build comp' / 'Build comp'
'mode.scout': 'Scout directions' / 'Scout directions'
'filter.early_board': 'Early game board' / 'Early game board'
'filter.scout_button': 'Scout' / 'Scout'
'scout.keep': 'Keep' / 'Trzymaj'
'scout.sell': 'Sell' / 'Sprzedaj'
'scout.sell_later': 'Sell later' / 'Sprzedaj pozniej'
'scout.add': 'Add' / 'Dodaj'
'scout.at_level': 'at lv' / 'na lv'
'scout.no_synergy': 'no synergy' / 'brak synergii'
'scout.meta_avg': 'meta avg' / 'meta avg'
'scout.units_kept': 'units kept' / 'unitow trzymanych'
'scout.show_transitions': 'Show transitions' / 'Pokaz przejscia'
```

## Files Changed

| File | Change |
|------|--------|
| `server/src/routes/scout.js` | NEW — POST /api/scout endpoint |
| `server/src/index.js` | Register scout route |
| `client/src/api.js` | Add `scoutDirections()` function |
| `client/src/components/FilterPanel.jsx` | Add mode toggle, adjust labels |
| `client/src/components/ResultsPanel.jsx` | Render ScoutResultCard in scout mode |
| `client/src/components/ScoutResultCard.jsx` | NEW — direction card component |
| `client/src/i18n.jsx` | Add scout mode translations |

## Out of Scope

- Multi-step interactive scouting (user updates input each round) — works naturally by user changing early units and re-scouting
- Item recommendations per direction
- Augment-aware scouting
- Stage-specific advice (when to level, when to roll)
