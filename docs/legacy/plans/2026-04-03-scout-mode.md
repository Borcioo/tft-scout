# Scout Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Scout directions" mode that takes early game units and suggests 2-3 endgame directions with keep/sell/add guidance.

**Architecture:** New `/api/scout` endpoint reuses existing `generateTeams` engine with modified constraints per direction. Frontend adds mode toggle and new ScoutResultCard component. Early units get soft scoring bonus (not hard-locked).

**Tech Stack:** Node.js/Express (ESM), React, better-sqlite3, vitest

**Spec:** `docs/superpowers/specs/2026-04-03-scout-mode-design.md`

---

### Task 1: Scout Route — Core Logic

**Files:**
- Create: `server/src/routes/scout.js`
- Create: `server/tests/scout.test.js`

- [ ] **Step 1: Write tests for helper functions**

Create `server/tests/scout.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { collectTraitAffinity, buildKeepSellAdd, estimateAddLevel } from '../src/routes/scout.js';

describe('collectTraitAffinity', () => {
  it('counts traits from early units', () => {
    const units = [
      { traits: ['TFT17_DarkStar', 'TFT17_HPTank'] },
      { traits: ['TFT17_DarkStar', 'TFT17_ShieldTank', 'TFT17_ManaTrait'] },
      { traits: ['TFT17_AssassinTrait', 'TFT17_Stargazer'] },
    ];
    const aff = collectTraitAffinity(units);
    expect(aff['TFT17_DarkStar']).toBe(2);
    expect(aff['TFT17_HPTank']).toBe(1);
    expect(aff['TFT17_AssassinTrait']).toBe(1);
  });
});

describe('estimateAddLevel', () => {
  it('returns 5-6 for 1-2 cost', () => {
    expect(estimateAddLevel(1)).toBeLessThanOrEqual(6);
    expect(estimateAddLevel(2)).toBeLessThanOrEqual(7);
  });

  it('returns 7-8 for 4 cost', () => {
    expect(estimateAddLevel(4)).toBeGreaterThanOrEqual(7);
    expect(estimateAddLevel(4)).toBeLessThanOrEqual(8);
  });

  it('returns 8-9 for 5 cost', () => {
    expect(estimateAddLevel(5)).toBeGreaterThanOrEqual(8);
  });
});

describe('buildKeepSellAdd', () => {
  const earlyUnits = [
    { apiName: 'TFT17_Mordekaiser', name: 'Mordekaiser', cost: 2, traits: ['TFT17_ShieldTank', 'TFT17_DarkStar', 'TFT17_ManaTrait'] },
    { apiName: 'TFT17_ChoGath', name: "Cho'Gath", cost: 1, traits: ['TFT17_DarkStar', 'TFT17_HPTank'] },
    { apiName: 'TFT17_Talon', name: 'Talon', cost: 1, traits: ['TFT17_AssassinTrait', 'TFT17_Stargazer'] },
  ];

  it('marks early units in endgame as keep', () => {
    const endgameApiNames = ['TFT17_Mordekaiser', 'TFT17_Jhin', 'TFT17_Shen'];
    const endgameChamps = [
      { apiName: 'TFT17_Mordekaiser', name: 'Mordekaiser', cost: 2 },
      { apiName: 'TFT17_Jhin', name: 'Jhin', cost: 5 },
      { apiName: 'TFT17_Shen', name: 'Shen', cost: 5 },
    ];
    const directionTraits = ['TFT17_DarkStar'];
    const result = buildKeepSellAdd(earlyUnits, endgameChamps, directionTraits);
    expect(result.keep.some(u => u.apiName === 'TFT17_Mordekaiser')).toBe(true);
    expect(result.add.some(u => u.apiName === 'TFT17_Jhin')).toBe(true);
  });

  it('marks early units with no trait overlap as sell', () => {
    const endgameChamps = [
      { apiName: 'TFT17_Jhin', name: 'Jhin', cost: 5 },
    ];
    const directionTraits = ['TFT17_DarkStar'];
    const result = buildKeepSellAdd(earlyUnits, endgameChamps, directionTraits);
    // Talon has no Dark Star → sell
    expect(result.sell.some(u => u.apiName === 'TFT17_Talon')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/scout.test.js`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement scout.js**

Create `server/src/routes/scout.js`:

```js
import { Router } from 'express';
import { generateTeams } from '../scoring/engine.js';

export function collectTraitAffinity(units) {
  const counts = {};
  for (const u of units) {
    for (const t of (u.traits || [])) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}

export function estimateAddLevel(cost) {
  if (cost <= 1) return 5;
  if (cost === 2) return 6;
  if (cost === 3) return 7;
  if (cost === 4) return 8;
  return 9; // 5-cost
}

export function buildKeepSellAdd(earlyUnits, endgameChamps, directionTraits) {
  const endgameSet = new Set(endgameChamps.map(c => c.apiName));
  const directionTraitSet = new Set(directionTraits);

  const keep = [];
  const sellLater = [];
  const sell = [];

  for (const unit of earlyUnits) {
    if (endgameSet.has(unit.apiName)) {
      keep.push({ apiName: unit.apiName, name: unit.name, reason: 'in endgame comp' });
    } else {
      const hasOverlap = (unit.traits || []).some(t => directionTraitSet.has(t));
      if (hasOverlap) {
        // Find who replaces this unit (same trait, higher cost, in endgame)
        const replacement = endgameChamps.find(c =>
          !earlyUnits.some(e => e.apiName === c.apiName) && c.cost > unit.cost
        );
        sellLater.push({
          apiName: unit.apiName, name: unit.name,
          replacedBy: replacement?.name || null,
          atLevel: replacement ? estimateAddLevel(replacement.cost) : null,
          reason: 'shares traits but upgrades available',
        });
      } else {
        sell.push({ apiName: unit.apiName, name: unit.name, reason: 'no synergy with direction' });
      }
    }
  }

  const earlySet = new Set(earlyUnits.map(u => u.apiName));
  const add = endgameChamps
    .filter(c => !earlySet.has(c.apiName))
    .map(c => ({
      apiName: c.apiName, name: c.name,
      atLevel: estimateAddLevel(c.cost),
    }));

  return { keep, sellLater, sell, add };
}

export function scoutRoutes(db) {
  const router = Router();

  router.post('/', (req, res) => {
    const {
      earlyUnits: earlyApiNames = [],
      targetLevel = 8,
      emblems = [],
      excludedTraits = [],
      stargazerVariant = null,
      max5Cost = null,
    } = req.body;

    // Load early unit data from DB
    if (earlyApiNames.length === 0) {
      return res.json({ directions: [], earlyTraitAffinity: {} });
    }

    const placeholders = earlyApiNames.map(() => '?').join(',');
    const earlyUnits = db.prepare(`
      SELECT c.*, GROUP_CONCAT(t.apiName) as traitApiNames, GROUP_CONCAT(t.name) as traitNames
      FROM champions c
      LEFT JOIN champion_traits ct ON ct.championId = c.id
      LEFT JOIN traits t ON t.id = ct.traitId
      WHERE c.apiName IN (${placeholders})
      GROUP BY c.id
    `).all(...earlyApiNames);

    for (const u of earlyUnits) {
      u.traits = u.traitApiNames ? u.traitApiNames.split(',') : [];
      u.traitNameList = u.traitNames ? u.traitNames.split(',') : [];
    }

    // Collect trait affinity
    const affinity = collectTraitAffinity(earlyUnits);

    // Load metatft trait ratings for direction quality
    let traitRatings = {};
    try {
      const rows = db.prepare('SELECT apiName, breakpointIndex, score, games FROM metatft_trait_ratings').all();
      for (const r of rows) {
        if (!traitRatings[r.apiName]) traitRatings[r.apiName] = {};
        traitRatings[r.apiName][r.breakpointIndex] = { score: r.score, games: r.games };
      }
    } catch (e) { /* no metatft data yet */ }

    // Find candidate directions: traits with 2+ early units or high metatft score + 1 unit
    const candidateTraits = [];
    for (const [trait, count] of Object.entries(affinity)) {
      // Skip unique traits (they don't form directions)
      const traitData = db.prepare('SELECT t.*, MIN(tb.minUnits) as firstBp FROM traits t LEFT JOIN trait_breakpoints tb ON tb.traitId = t.id WHERE t.apiName = ?').get(trait);
      if (!traitData || traitData.firstBp === 1) continue;

      const bestRating = traitRatings[trait] ? Math.max(...Object.values(traitRatings[trait]).map(r => r.score)) : 0;

      if (count >= 2 || (count >= 1 && bestRating > 0.6)) {
        candidateTraits.push({
          apiName: trait,
          name: traitData.name,
          earlyCount: count,
          bestRating,
          relevance: count * 2 + bestRating * 3,
        });
      }
    }

    // Sort by relevance, take top 4
    candidateTraits.sort((a, b) => b.relevance - a.relevance);
    const topCandidates = candidateTraits.slice(0, 4);

    // Load meta comps for avg place info
    let metaComps = [];
    try {
      metaComps = db.prepare('SELECT * FROM metatft_meta_comps ORDER BY avgPlace ASC').all()
        .map(c => ({ ...c, units: JSON.parse(c.units) }));
    } catch (e) { /* no data */ }

    // Generate endgame comp per direction
    const EARLY_BONUS = 3;
    const directions = [];

    for (const candidate of topCandidates) {
      // Find first meaningful breakpoint for this trait
      const bps = db.prepare(
        'SELECT minUnits FROM trait_breakpoints WHERE traitId = (SELECT id FROM traits WHERE apiName = ?) ORDER BY minUnits'
      ).all(candidate.apiName);
      const minCount = bps.length > 0 ? bps[0].minUnits : 2;

      const constraints = {
        lockedChampions: [],
        lockedTraits: [{ apiName: candidate.apiName, minCount }],
        emblems,
        excludedChampions: [],
        excludedTraits,
        mechaEnhanced: [],
        level: targetLevel,
        roleBalance: null,
        stargazerVariant,
        max5Cost,
        // earlyBonus is handled by passing early unit apiNames
        earlyBonusUnits: earlyApiNames,
      };

      const comps = generateTeams(db, constraints, { topN: 1, iterations: 300 });
      if (comps.length === 0) continue;

      const endgame = comps[0];

      // Build keep/sell/add
      const analysis = buildKeepSellAdd(
        earlyUnits,
        endgame.champions,
        [candidate.apiName],
      );

      // Find meta comp overlap
      let metaAvgPlace = null;
      const endgameSet = new Set(endgame.champions.map(c => c.apiName));
      for (const meta of metaComps) {
        const overlap = meta.units.filter(u => endgameSet.has(u)).length / Math.max(meta.units.length, endgameSet.size);
        if (overlap > 0.4) {
          metaAvgPlace = meta.avgPlace;
          break;
        }
      }

      directions.push({
        name: candidate.name,
        mainTrait: candidate.apiName,
        metaAvgPlace,
        endgameComp: endgame,
        earlyAnalysis: analysis,
        earlyUnitsKept: analysis.keep.length,
        score: endgame.score,
      });
    }

    // Sort by score, then by early units kept
    directions.sort((a, b) => (b.score - a.score) || (b.earlyUnitsKept - a.earlyUnitsKept));

    // Take top 3
    res.json({
      directions: directions.slice(0, 3),
      earlyTraitAffinity: affinity,
    });
  });

  return router;
}
```

- [ ] **Step 4: Add earlyBonusUnits support to engine.js**

In `server/src/scoring/engine.js`, in the `quickScore` function, after the locked traits penalty section (around line 315), add:

```js
  // Early game bonus: soft preference for early units in scout mode
  if (ctx.earlyBonusUnits) {
    const earlySet = new Set(ctx.earlyBonusUnits);
    for (const champ of teamChampions) {
      if (earlySet.has(champ.apiName)) score += 3;
    }
  }
```

Also in `generateTeams`, extract `earlyBonusUnits` from constraints and add to ctx:

In the destructuring line:
```js
const { ..., earlyBonusUnits = null } = constraints;
```

In the ctx building line, add `earlyBonusUnits`.

- [ ] **Step 5: Run tests**

Run: `cd server && npx vitest run tests/scout.test.js`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/scout.js server/tests/scout.test.js server/src/scoring/engine.js
git commit -m "feat: scout route — find endgame directions from early game units"
```

---

### Task 2: Register Scout Route

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Add import and register route**

In `server/src/index.js`, add import:
```js
import { scoutRoutes } from './routes/scout.js';
```

Add route registration:
```js
app.use('/api/scout', scoutRoutes(db));
```

- [ ] **Step 2: Verify all tests pass**

Run: `cd server && npx vitest run`

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "feat: register /api/scout route"
```

---

### Task 3: Frontend API + i18n

**Files:**
- Modify: `client/src/api.js`
- Modify: `client/src/i18n.jsx`

- [ ] **Step 1: Add scoutDirections API function**

In `client/src/api.js`, add:

```js
export async function scoutDirections(params) {
  const res = await fetch(BASE + '/scout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}
```

- [ ] **Step 2: Add i18n keys**

In `client/src/i18n.jsx`, add to the `pl` translations object (before the closing `},` of pl):

```js
    'mode.build': 'Build comp',
    'mode.scout': 'Scout',
    'filter.early_board': 'Early game board',
    'filter.scout_button': 'Scout',
    'scout.keep': 'Trzymaj',
    'scout.sell': 'Sprzedaj',
    'scout.sell_later': 'Sprzedaj pozniej',
    'scout.add': 'Dodaj',
    'scout.at_level': 'na lv',
    'scout.no_synergy': 'brak synergii',
    'scout.meta_avg': 'meta avg',
    'scout.direction': 'Kierunek',
    'scout.endgame': 'Endgame',
    'scout.from_board': 'Z Twojego boardu',
    'scout.show_transitions': 'Pokaz przejscia',
    'scout.units_kept': 'unitow trzymanych',
```

Add to `en` translations:

```js
    'mode.build': 'Build comp',
    'mode.scout': 'Scout',
    'filter.early_board': 'Early game board',
    'filter.scout_button': 'Scout',
    'scout.keep': 'Keep',
    'scout.sell': 'Sell',
    'scout.sell_later': 'Sell later',
    'scout.add': 'Add',
    'scout.at_level': 'at lv',
    'scout.no_synergy': 'no synergy',
    'scout.meta_avg': 'meta avg',
    'scout.direction': 'Direction',
    'scout.endgame': 'Endgame',
    'scout.from_board': 'From your board',
    'scout.show_transitions': 'Show transitions',
    'scout.units_kept': 'units kept',
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api.js client/src/i18n.jsx
git commit -m "feat: add scout API function and i18n translations"
```

---

### Task 4: ScoutResultCard Component

**Files:**
- Create: `client/src/components/ScoutResultCard.jsx`

- [ ] **Step 1: Create ScoutResultCard**

Create `client/src/components/ScoutResultCard.jsx`:

```jsx
import { useState } from 'react';
import { useI18n } from '../i18n.jsx';
import TraitBadge from './TraitBadge';

const COST_COLORS = {
  1: 'border-gray-400', 2: 'border-green-400', 3: 'border-blue-400',
  4: 'border-purple-400', 5: 'border-yellow-400',
};

function ChampIcon({ champ }) {
  return (
    <div className={'relative w-10 h-10 rounded border-2 ' + (COST_COLORS[champ.cost] || 'border-gray-500')}
      title={champ.name + ' (' + champ.cost + 'g)'}>
      {champ.icon ? (
        <img src={'https://CDRAGON_REDACTED/pbe/game/' + champ.icon.toLowerCase().replace('.tex', '.png')}
          alt={champ.name} className="w-full h-full rounded object-cover" />
      ) : (
        <span className="text-[8px] flex items-center justify-center h-full">{champ.name.slice(0, 3)}</span>
      )}
    </div>
  );
}

export default function ScoutResultCard({ direction, rank }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const { earlyAnalysis, endgameComp } = direction;

  return (
    <div className="rounded-lg p-4 mb-3 border bg-gray-800 border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-400">
            {rank}. {direction.name}
          </span>
          {direction.metaAvgPlace && (
            <span className="text-xs text-gray-500">
              {t('scout.meta_avg')} {direction.metaAvgPlace.toFixed(2)}
            </span>
          )}
        </div>
        <span className="text-sm font-mono bg-gray-700 px-2 py-0.5 rounded">
          Score: {Math.round(direction.score)}
        </span>
      </div>

      {/* Endgame comp */}
      <div className="mb-3">
        <p className="text-xs text-gray-500 mb-1">
          {t('scout.endgame')} (lv{endgameComp.champions?.length || '?'})
        </p>
        <div className="flex flex-wrap gap-1 mb-2">
          {(endgameComp.champions || []).map(c => (
            <ChampIcon key={c.apiName} champ={c} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(endgameComp.activeTraits || []).sort((a, b) => b.style - a.style).map(tr => (
            <TraitBadge key={tr.apiName} trait={tr} />
          ))}
        </div>
      </div>

      {/* Keep / Sell / Add */}
      <div className="border-t border-gray-700 pt-2">
        <p className="text-xs text-gray-500 mb-2">{t('scout.from_board')}:</p>

        {earlyAnalysis.keep.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            <span className="text-xs text-green-400 w-20">{t('scout.keep')}:</span>
            {earlyAnalysis.keep.map(u => (
              <span key={u.apiName} className="text-xs bg-green-900 text-green-300 px-1.5 py-0.5 rounded">
                {u.name}
              </span>
            ))}
          </div>
        )}

        {earlyAnalysis.sellLater.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            <span className="text-xs text-yellow-400 w-20">{t('scout.sell_later')}:</span>
            {earlyAnalysis.sellLater.map(u => (
              <span key={u.apiName} className="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded"
                title={u.replacedBy ? `→ ${u.replacedBy} ${t('scout.at_level')} ${u.atLevel}` : ''}>
                {u.name} {u.replacedBy && <span className="text-yellow-500">→ {u.replacedBy}</span>}
              </span>
            ))}
          </div>
        )}

        {earlyAnalysis.sell.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            <span className="text-xs text-red-400 w-20">{t('scout.sell')}:</span>
            {earlyAnalysis.sell.map(u => (
              <span key={u.apiName} className="text-xs bg-red-900 text-red-300 px-1.5 py-0.5 rounded">
                {u.name}
              </span>
            ))}
          </div>
        )}

        {earlyAnalysis.add.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            <span className="text-xs text-blue-400 w-20">{t('scout.add')}:</span>
            {earlyAnalysis.add.map(u => (
              <span key={u.apiName} className="text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">
                {u.name} <span className="text-blue-500">{t('scout.at_level')} {u.atLevel}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Units kept count */}
      <div className="text-xs text-gray-600 mt-2">
        {direction.earlyUnitsKept} {t('scout.units_kept')}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/ScoutResultCard.jsx
git commit -m "feat: ScoutResultCard component — direction card with keep/sell/add"
```

---

### Task 5: FilterPanel Mode Toggle + ResultsPanel Integration

**Files:**
- Modify: `client/src/components/FilterPanel.jsx`
- Modify: `client/src/components/ResultsPanel.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Add mode state and toggle to FilterPanel**

In `client/src/components/FilterPanel.jsx`:

Add to imports:
```js
import { scoutDirections } from '../api';
```

Add `mode` state after `stargazerVariant`:
```js
  const [mode, setMode] = useState('build');
```

Add scout handler after `handleGenerate`:
```js
  const handleScout = useCallback(async () => {
    onLoading(true);
    try {
      const params = {
        earlyUnits: lockedChampions,
        targetLevel: level,
        emblems: selectedEmblems,
        excludedTraits,
        stargazerVariant: stargazerVariant || null,
        max5Cost: max5CostEnabled ? max5Cost : null,
      };
      const result = await scoutDirections(params);
      onResults(result.directions || []);
      if (onDebugData) onDebugData({ mode: 'scout', params, result });
    } catch (err) { console.error('Scout failed:', err); }
    finally { onLoading(false); }
  }, [lockedChampions, level, selectedEmblems, excludedTraits, stargazerVariant, max5CostEnabled, max5Cost, onResults, onLoading]);
```

Add mode toggle UI right after `<h2>` title:
```jsx
      {/* Mode toggle */}
      <div className="flex mb-4 bg-gray-800 rounded border border-gray-700 p-0.5">
        <button onClick={() => setMode('build')}
          className={'flex-1 text-xs py-1.5 rounded transition-colors ' +
            (mode === 'build' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
          {t('mode.build')}
        </button>
        <button onClick={() => setMode('scout')}
          className={'flex-1 text-xs py-1.5 rounded transition-colors ' +
            (mode === 'scout' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
          {t('mode.scout')}
        </button>
      </div>
```

Change the champions label based on mode:
```jsx
      <ChampionPicker champions={champions} selected={lockedChampions} onChange={setLockedChampions}
        exclude={excludedChampions} label={mode === 'scout' ? t('filter.early_board') : t('filter.my_champions')} />
```

Change the generate button to call scout in scout mode:
```jsx
      <button onClick={mode === 'scout' ? handleScout : handleGenerate}
        className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded transition-colors">
        {mode === 'scout' ? t('filter.scout_button') : t('filter.generate')}
      </button>
```

Pass mode to parent via onDebugData (already done in handleScout above).

- [ ] **Step 2: Track mode in App and pass to ResultsPanel**

In `client/src/App.jsx`, add mode state:
```js
  const [resultMode, setResultMode] = useState('build');
```

Update the results handler to also track mode:
```jsx
  const handleResults = useCallback((data) => {
    setResults(data);
  }, []);

  const handleDebugData = useCallback((data) => {
    setDebugData(data);
    if (data?.mode) setResultMode(data.mode);
  }, []);
```

Pass to ResultsPanel:
```jsx
  <ResultsPanel results={results} loading={loading} mode={resultMode}
    savedTeams={savedTeams} onToggleSave={handleToggleSave}
    targetLevel={debugData?.constraints?.level || 8} />
```

Update FilterPanel props:
```jsx
  <FilterPanel champions={champions} traits={traits}
    onResults={handleResults} onLoading={setLoading}
    onDebugData={handleDebugData} onApplyConstraints={applyConstraintsRef} />
```

- [ ] **Step 3: Update ResultsPanel to handle scout mode**

In `client/src/components/ResultsPanel.jsx`:

Add import:
```js
import ScoutResultCard from './ScoutResultCard';
```

Update component to accept and use `mode` prop:
```js
export default function ResultsPanel({ results, loading, savedTeams, onToggleSave, targetLevel, mode = 'build' }) {
```

In the results tab rendering, change the results map to:
```jsx
          ) : results.length > 0 ? (
            mode === 'scout' ? (
              results.map((direction, i) => (
                <ScoutResultCard key={i} direction={direction} rank={i + 1} />
              ))
            ) : (
              results.map((team, i) => {
                const fp = team.champions.map(c => c.apiName).sort().join(',');
                return (
                  <TeamCard key={i} team={team} rank={i + 1}
                    saved={savedKeys.has(fp)} onToggleSave={onToggleSave} targetLevel={targetLevel} />
                );
              })
            )
          ) : (
```

- [ ] **Step 4: Run app and test manually**

Start server and client. Verify:
1. Toggle between Build comp / Scout modes
2. In scout mode, pick 2-3 early game champions
3. Click Scout → see 2-3 direction cards with keep/sell/add
4. Toggle back to Build comp → normal behavior

- [ ] **Step 5: Commit**

```bash
git add client/src/components/FilterPanel.jsx client/src/components/ResultsPanel.jsx client/src/App.jsx
git commit -m "feat: scout mode UI — mode toggle, ScoutResultCard integration"
```
