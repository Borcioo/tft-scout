# Scoring Refactor — MetaTFT Data-Driven Scoring

## Problem

Current scoring algorithm uses hardcoded `styleMultiplier = {1:4, 3:8, 4:12, 5:18}` which treats all traits at the same breakpoint style equally. This causes:

1. **Primordian 3 (prismatic) = Dark Star 6 (prismatic) = 18 pts** — but Primordian is tier B (avgPlace 4.47) while Dark Star 6 is tier S (avgPlace 3.99)
2. **Rogue 3 (silver) = 8 pts** — but it's tier S (avgPlace 3.37), massively undervalued
3. **All unique traits = flat 5 pts** — but Bulwark (Shen) is S-tier (3.73) while Galaxy Hunter (Zed) is D-tier (4.85)
4. **No level/phase awareness** — Primordian is good early, terrible late
5. **Tier list dominates** — S-tier = +10 drowns out all other signals
6. **Magic numbers scattered** — no central config, hard to tune

## Solution

Replace blind style-based scoring with real performance data from MetaTFT API. Cache data locally in SQLite, refresh on demand via button.

## MetaTFT API Endpoints

All endpoints return `places: [p1,p2,...,p8]` — count of games finishing at each position (1st through 8th).

```
Base: https://METATFT_API_REDACTED

1. Trait ratings (per trait per breakpoint):
   GET /tft-stat-api/traits?queue=PBE&patch=current&days=3&permit_filter_adjustment=true

   Format: { trait: "TFT17_DarkStar_1", places: [12626,10304,...] }
   Suffix _1 = first breakpoint, _2 = second, etc.
   Includes Stargazer variants: TFT17_Stargazer_Serpent_1, etc.

2. Unit ratings (per champion):
   GET /tft-stat-api/units?queue=PBE&patch=current&days=3&permit_filter_adjustment=true

   Format: { unit: "TFT17_Aatrox", places: [15992,17028,...] }

3. Meta comps (team compositions):
   GET /tft-comps-api/comps_data?queue=PBE&patch=current&days=3&permit_filter_adjustment=true&region_hint=eun1

   Format: cluster_details map with units_string, traits_string, overall.avg, overall.count, builds, levelling

Note: queue=PBE for Set17. When Set17 goes live, change to queue=RANKED.
```

## Database Schema

```sql
CREATE TABLE metatft_trait_ratings (
  apiName TEXT NOT NULL,          -- e.g. TFT17_DarkStar
  breakpointIndex INTEGER NOT NULL, -- 1-based index matching trait_breakpoints order
  avgPlace REAL NOT NULL,
  winRate REAL NOT NULL,
  top4Rate REAL NOT NULL,
  games INTEGER NOT NULL,
  score REAL NOT NULL,            -- (6.0 - avgPlace) / 3.0, clamped [0, 1]
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (apiName, breakpointIndex)
);

CREATE TABLE metatft_unit_ratings (
  apiName TEXT NOT NULL PRIMARY KEY,
  avgPlace REAL NOT NULL,
  winRate REAL NOT NULL,
  top4Rate REAL NOT NULL,
  games INTEGER NOT NULL,
  score REAL NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE metatft_meta_comps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clusterId TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  units TEXT NOT NULL,            -- JSON array of apiNames
  traits TEXT NOT NULL,           -- JSON array of trait strings
  avgPlace REAL NOT NULL,
  games INTEGER NOT NULL,
  levelling TEXT,
  builds TEXT,                    -- JSON: top builds per unit
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Score formula

```
score = (6.0 - avgPlace) / 3.0   clamped to [0.0, 1.0]

avgPlace 3.0 → score 1.0 (dominant)
avgPlace 4.0 → score 0.67 (solid)
avgPlace 4.5 → score 0.50 (average)
avgPlace 5.0 → score 0.33 (weak)
avgPlace 6.0 → score 0.0 (trap)
```

### Stargazer handling

MetaTFT tracks each variant separately (Serpent, Wolf, Mountain, Fountain, Huntress, Medallion, Shield). Import stores them under their full apiName (e.g. `TFT17_Stargazer_Serpent`).

Scorer behavior:
- If `constraints.stargazerVariant` is set → use that variant's ratings
- If not set → compute weighted average of all variants by frequency (games played)

### Meta comps filtering

Only import comps with `avgPlace < 4.5` — weak comps are noise. Store top comps as reference for benchmarking.

## Importer: `server/src/import-metatft.js`

Single script that fetches all 3 endpoints and populates/replaces all 3 tables. Run via:
- API endpoint: `POST /api/metatft/refresh`
- Button on frontend

### Trait mapping logic

MetaTFT format: `TFT17_DarkStar_1` → split on last `_` → apiName=`TFT17_DarkStar`, breakpointIndex=1

Special case — Stargazer variants: `TFT17_Stargazer_Serpent_1` → apiName=`TFT17_Stargazer_Serpent`, breakpointIndex=1. The base `TFT17_Stargazer` trait (which champions are assigned to in our DB) gets a weighted average computed at query time.

## Scoring Config

New file: `server/src/scoring/config.js`

```js
export const SCORING_CONFIG = {
  weights: {
    traitRating:     15.0,  // metatft trait score × this = max trait contribution
    unitRating:       8.0,  // metatft unit score × this = champion rating contribution
    tierList:         4.0,  // S=1.0, A=0.8, B=0.6, C=0.4, D=0.2 × this weight
    championPower:    3.0,  // star power + cost base (existing logic, reduced)
    uniqueTrait:     10.0,  // unique trait max (scaled by metatft rating)
    synergyBonus:     3.0,  // bonus per trait at 2nd+ breakpoint
    overflowPenalty:  4.0,  // penalty per wasted unit above breakpoint
    costPenalty:      5.0,  // penalty per unit exceeding shop odds limits
  },

  // Normalized tier values (replacing TIER_WEIGHTS 10/8/6/4/2)
  tierValues: { S: 1.0, A: 0.8, B: 0.6, C: 0.4, D: 0.2 },

  // Near-breakpoint bonus (1 unit from next breakpoint)
  nearBreakpointBonus: 2.0,

  // Minimum games for a metatft rating to be considered reliable
  minGamesForReliable: 300,

  // Fallback style multipliers when no metatft data available
  // Normalized to 0-1 range (old values were 4/8/12/18)
  fallbackStyleScore: { 1: 0.22, 3: 0.44, 4: 0.67, 5: 1.0, 6: 1.0 },
};
```

## Revised Scoring Functions

### traitScore(apiName, unitCount, breakpoints, ctx)

```
1. Determine which breakpoint is active (existing logic)
2. Look up metatft_trait_ratings for (apiName, breakpointIndex)
   - For Stargazer: use variant from constraints, or weighted average
3. If rating exists AND games >= minGamesForReliable:
     traitPts = rating.score × weights.traitRating
   Else (fallback):
     traitPts = fallbackStyleScore[style] × weights.traitRating
4. Near-breakpoint: if 1 unit from next → +nearBreakpointBonus
5. Overflow: units above breakpoint but far from next → penalty
6. Return traitPts + adjustments
```

### championScore(champion, tier, ctx)

```
1. Look up metatft_unit_ratings for champion.apiName
2. If rating exists AND games >= minGamesForReliable:
     unitPts = rating.score × weights.unitRating
   Else:
     unitPts = (existing star power logic) × weights.championPower
3. tierPts = tierValues[tier] × weights.tierList
4. Return unitPts + tierPts
```

### Unique trait scoring

No longer flat 5. Uses same metatft lookup:
```
Bulwark (Shen):  avgPlace 3.73 → score 0.76 → 0.76 × 10 = 7.6
Eradicator (Jhin): avgPlace 3.97 → score 0.68 → 6.8
Galaxy Hunter (Zed): avgPlace 4.85 → score 0.38 → 3.8
```

## Stargazer Variant Filter

### API constraint

```js
constraints: {
  // ... existing fields ...
  stargazerVariant: 'Serpent'  // optional: Wolf, Mountain, Fountain, Huntress, Medallion, Shield
}
```

### Frontend

Dropdown in FilterPanel, visible when relevant (Stargazer champion locked or Stargazer trait locked). Options populated from available variants in DB.

## Benchmark Endpoint

`POST /api/benchmark`

Generates comps with predefined scenarios and evaluates them against meta comps.

### Request

```json
{
  "scenarios": [
    { "name": "empty_lvl8", "constraints": { "level": 8 } },
    { "name": "dark_star", "constraints": { "level": 8, "lockedTraits": ["TFT17_DarkStar"] } },
    { "name": "with_shen_jhin", "constraints": { "level": 9, "lockedChampions": ["TFT17_Shen", "TFT17_Jhin"] } }
  ],
  "topN": 5,
  "iterations": 500
}
```

### Response

```json
{
  "results": [
    {
      "scenario": "empty_lvl8",
      "generatedComps": [ /* top 5 comps with scores */ ],
      "analysis": {
        "avgScore": 45.2,
        "traitBreakdown": { /* avg active traits, avg breakpoint tier */ },
        "metaOverlap": {
          "bestMatch": "TFT17_DarkStar, TFT17_Rammus",
          "unitOverlap": 6,       // out of 9
          "metaAvgPlace": 3.31
        }
      }
    }
  ],
  "metaReference": [
    // Top 10 meta comps for comparison
  ]
}
```

### Meta overlap scoring

For each generated comp, find the meta comp with highest champion overlap:
```
overlapScore = matchingChampions / totalChampions
```

This lets us evaluate: "does our generator produce comps that real players actually play and win with?"

## Files Changed

| File | Change |
|------|--------|
| `server/src/scoring/config.js` | NEW — centralized SCORING_CONFIG |
| `server/src/scoring/scorer.js` | Rewrite traitScore, championScore, teamScore to use metatft data + config |
| `server/src/scoring/engine.js` | Pass metatft context to scoring, add stargazerVariant handling |
| `server/src/import-metatft.js` | NEW — fetch all 3 endpoints, populate DB tables |
| `server/src/db.js` | Add 3 new tables |
| `server/src/routes/metatft.js` | NEW — POST /refresh, GET /status |
| `server/src/routes/benchmark.js` | NEW — POST /api/benchmark |
| `server/src/routes/generate.js` | Accept stargazerVariant constraint |
| `server/src/index.js` | Register new routes |
| `client/src/components/FilterPanel.jsx` | Stargazer variant dropdown, metatft refresh button |

## Migration

- Existing scoring works as fallback when no metatft data imported
- First run: user clicks "Refresh MetaTFT Data" button → imports everything
- All old tests continue to pass (fallback path)

## Out of Scope

- Auto-refresh on schedule (manual button only)
- Item recommendations (comps_data has builds but we don't use them yet)
- Augment data
- Level-specific scoring (metatft data is aggregated, not per-level)
