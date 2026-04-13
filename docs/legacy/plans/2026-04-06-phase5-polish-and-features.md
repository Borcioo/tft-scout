# Phase 5: Polish & Advanced Features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix algorithm bugs (slot overflow, Mecha 2x trait count), improve UI (trait icons, grid layout, comp cards), and add advanced features (emblems, score breakdown).

**Architecture:** All algorithm fixes are in pure `v2/server/src/algorithm/` files (no DB). UI changes in `v2/client/src/components/`. New features follow existing service→algorithm→mapper pattern.

**Tech Stack:** Node.js, React, shadcn/ui, Tailwind, SQLite, lucide-react (icons)

---

### Task 1: Fix Mecha 2x trait count in scoring

Enhanced Mecha champions take 2 slots but currently don't count 2x for the Mecha trait. This means Mecha breakpoints are harder to hit than they should be.

**Files:**
- Modify: `v2/server/src/algorithm/engine.js:72-81`
- Modify: `v2/server/src/algorithm/synergy-graph.js` (quickScore function)

- [ ] **Step 1: Fix trait counting in engine.js**

In `v2/server/src/algorithm/engine.js`, replace the trait counting block (lines 72-81):

```javascript
    const traitCounts = {};
    let totalSlots = 0;
    for (const c of team.champions) {
      totalSlots += c.slotsUsed || 1;
      for (const t of c.traits) {
        // Enhanced Mecha champions count 2x for Mecha trait
        const isMechaEnhanced = c.variant === 'enhanced' && t === 'TFT17_Mecha';
        traitCounts[t] = (traitCounts[t] || 0) + (isMechaEnhanced ? 2 : 1);
      }
    }
    // Add emblems
    for (const e of (constraints.emblems || [])) {
      traitCounts[e] = (traitCounts[e] || 0) + 1;
    }
```

- [ ] **Step 2: Fix trait counting in synergy-graph.js quickScore**

In `v2/server/src/algorithm/synergy-graph.js`, in the `quickScore` function, replace the trait counting block:

```javascript
  const traitCounts = {};
  for (const api of champApis) {
    const node = nodes[api];
    if (!node) continue;
    for (const t of node.traits) {
      const isMechaEnhanced = node.variant === 'enhanced' && t === 'TFT17_Mecha';
      traitCounts[t] = (traitCounts[t] || 0) + (isMechaEnhanced ? 2 : 1);
    }
  }
  for (const e of emblems) traitCounts[e] = (traitCounts[e] || 0) + 1;
```

- [ ] **Step 3: Verify via CLI test**

Run: `cd v2/server && node src/test-cli.js`

Check "TEST 2: MF Conduit + Urgot Enhanced" output — Urgot Enhanced should show `Mecha(3)` (2 from enhanced + 1 from... wait, only Urgot is Mecha here). If only Urgot Enhanced is locked, Mecha count should be 2 from him alone.

- [ ] **Step 4: Commit**

```bash
git add v2/server/src/algorithm/engine.js v2/server/src/algorithm/synergy-graph.js
git commit -m "fix: Mecha Enhanced counts 2x for Mecha trait in scoring"
```

---

### Task 2: Fix slot overflow — filter comps exceeding level

Comps with 9/8 slots appear because Enhanced champions take 2 slots but the team builder doesn't account for dynamically-added Enhanced variants.

**Files:**
- Modify: `v2/server/src/algorithm/engine.js:87-95`

- [ ] **Step 1: Add slot validation to result filtering**

In `v2/server/src/algorithm/engine.js`, after the `enriched` array is built (after the `.map()` block), add slot filtering before the final sort:

```javascript
  // Filter out comps that exceed slot budget
  const maxSlots = level;
  const validComps = enriched.filter(r => r.slotsUsed <= maxSlots);

  // Sort by final score and return top N
  validComps.sort((a, b) => b.score - a.score);
  return validComps.slice(0, topN);
```

Remove the old sort+slice at the end of the function.

- [ ] **Step 2: Verify via CLI**

Run: `cd v2/server && node src/test-cli.js`

Confirm no comp has `slots: 9/8` or `slots: 10/8` in the output.

- [ ] **Step 3: Commit**

```bash
git add v2/server/src/algorithm/engine.js
git commit -m "fix: filter comps that exceed slot budget from level"
```

---

### Task 3: Champion grid — cost section headers + sort by cost in comps

**Files:**
- Modify: `v2/client/src/components/champions/ChampionGrid.jsx`
- Modify: `v2/client/src/components/scout/CompCard.jsx`

- [ ] **Step 1: Add cost labels to champion grid sections**

In `v2/client/src/components/champions/ChampionGrid.jsx`, update the cost rendering section:

```jsx
      {visibleCosts.map(cost => (
        <div key={cost}>
          {!costFilter && (
            <div className="flex items-center gap-2 mb-1">
              <span className={cn(
                'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded',
                cost === 1 && 'bg-zinc-700 text-zinc-300',
                cost === 2 && 'bg-green-900 text-green-300',
                cost === 3 && 'bg-blue-900 text-blue-300',
                cost === 4 && 'bg-purple-900 text-purple-300',
                cost === 5 && 'bg-yellow-900 text-yellow-300',
              )}>
                {cost}$
              </span>
              <div className="h-px flex-1 bg-border/30" />
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {grouped[cost]?.map(champ => (
              <ChampionIcon
                key={champ.apiName}
                champion={champ}
                state={getState(champ.apiName)}
                onClick={onLock}
                onRightClick={onExclude}
                size="md"
              />
            ))}
          </div>
        </div>
      ))}
```

Add `import { cn } from '@/lib/utils';` at the top of the file.

- [ ] **Step 2: Sort champions by cost in CompCard**

In `v2/client/src/components/scout/CompCard.jsx`, sort champions by cost before rendering:

```jsx
        {/* Champions row */}
        <div className="flex gap-1 flex-wrap">
          {[...comp.champions].sort((a, b) => a.cost - b.cost).map(champ => (
            <ChampionIcon
              key={champ.apiName}
              champion={champ}
              state={lockedSet.has(champ.apiName) ? 'locked' : 'available'}
              size="sm"
            />
          ))}
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add v2/client/src/components/champions/ChampionGrid.jsx v2/client/src/components/scout/CompCard.jsx
git commit -m "ui: cost section headers in grid, sort comp champions by cost"
```

---

### Task 4: Trait icons in TraitBar

**Files:**
- Modify: `v2/client/src/components/scout/TraitBar.jsx`
- Modify: `v2/server/src/mappers/scout-result.mapper.js`
- Modify: `v2/server/src/algorithm/engine.js` (pass trait icon to activeTraits)

- [ ] **Step 1: Add trait icon to activeTraits in engine.js**

In `v2/server/src/algorithm/engine.js`, where activeTraits are built (the `activeTraits.push` block), add `icon`:

```javascript
      activeTraits.push({
        apiName,
        name: traitDef.name,
        icon: traitDef.icon,
        count,
        breakpoints: sorted,
        activeStyle: activeBp.style,
        activeBreakpoint: activeBp.minUnits,
      });
```

- [ ] **Step 2: Pass icon through scout-result mapper**

In `v2/server/src/mappers/scout-result.mapper.js`, add `icon` to activeTraits mapping:

```javascript
    activeTraits: result.activeTraits.map(t => ({
      apiName: t.apiName,
      name: t.name,
      icon: t.icon || null,
      count: t.count,
      style: t.activeStyle || null,
      breakpoint: t.activeBreakpoint || null,
    })),
```

- [ ] **Step 3: Render trait icons in TraitBar**

In `v2/client/src/components/scout/TraitBar.jsx`, update the Badge content:

```jsx
        <Badge
          key={trait.apiName}
          variant="outline"
          className={cn(
            'text-[10px] px-1.5 py-0 h-5 font-mono border flex items-center gap-0.5',
            STYLE_COLORS[trait.style] || 'bg-muted text-muted-foreground',
          )}
        >
          {trait.icon && (
            <img
              src={`/icons/traits/${trait.apiName}.png`}
              alt=""
              className="w-3 h-3"
            />
          )}
          {trait.name} {trait.count}
        </Badge>
```

- [ ] **Step 4: Commit**

```bash
git add v2/server/src/algorithm/engine.js v2/server/src/mappers/scout-result.mapper.js v2/client/src/components/scout/TraitBar.jsx
git commit -m "ui: add trait icons to TraitBar badges"
```

---

### Task 5: Emblem support in UI

Emblems add +1 to a trait count. The backend already supports `emblems` param — we need UI to select them.

**Files:**
- Create: `v2/client/src/components/scout/EmblemPicker.jsx`
- Modify: `v2/client/src/hooks/useScout.js`
- Modify: `v2/client/src/components/scout/ScoutPanel.jsx`

- [ ] **Step 1: Add emblem state to useScout hook**

In `v2/client/src/hooks/useScout.js`, add emblem management:

```javascript
  const [emblems, setEmblems] = useState([]);

  const toggleEmblem = useCallback((traitApiName) => {
    setEmblems(prev => {
      if (prev.includes(traitApiName)) return prev.filter(a => a !== traitApiName);
      return [...prev, traitApiName];
    });
  }, []);
```

Update the `clearAll` function:

```javascript
  const clearAll = useCallback(() => {
    setLocked([]);
    setExcluded([]);
    setEmblems([]);
    setResults([]);
  }, []);
```

Add `emblems` to the scout API call:

```javascript
        const data = await api.scout({
          lockedChampions: locked,
          excludedChampions: excluded,
          emblems,
          level,
          topN: 8,
        });
```

Add `emblems` to the dependency array of the useEffect and to the return object:

```javascript
  }, [locked, excluded, emblems, level]);

  return {
    locked, excluded, emblems, level, results, loading,
    toggleLock, toggleExclude, toggleEmblem, setLevel, clearAll,
  };
```

- [ ] **Step 2: Create EmblemPicker component**

Create `v2/client/src/components/scout/EmblemPicker.jsx`:

```jsx
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function EmblemPicker({ traits, emblems, onToggle }) {
  const [open, setOpen] = useState(false);

  // Only show shared traits (not unique, not "Choose Trait")
  const emblemTraits = traits.filter(t => !t.isUnique);

  const activeSet = new Set(emblems);

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-muted-foreground hover:text-foreground font-mono transition-colors"
        >
          + Emblem
        </button>
        {emblems.length > 0 && (
          <div className="flex gap-1">
            {emblems.map(api => {
              const trait = traits.find(t => t.apiName === api);
              return (
                <Badge
                  key={api}
                  variant="outline"
                  className="text-[10px] cursor-pointer bg-amber-900/40 border-amber-600 text-amber-200"
                  onClick={() => onToggle(api)}
                >
                  {trait?.name || api} x
                </Badge>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-mono">Select emblems</span>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground font-mono"
        >
          Done
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {emblemTraits.map(trait => (
          <Badge
            key={trait.apiName}
            variant="outline"
            className={cn(
              'text-[10px] cursor-pointer transition-colors',
              activeSet.has(trait.apiName)
                ? 'bg-amber-900/40 border-amber-600 text-amber-200'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted',
            )}
            onClick={() => onToggle(trait.apiName)}
          >
            {trait.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add EmblemPicker to ScoutPanel**

In `v2/client/src/components/scout/ScoutPanel.jsx`, add the imports and render:

```jsx
import { useTraits } from '@/hooks/useTraits';
import { EmblemPicker } from './EmblemPicker';
```

Inside the component, add:

```jsx
  const { traits } = useTraits();
```

Destructure `emblems` and `toggleEmblem` from `useScout()`.

Add EmblemPicker between LockedBar and ResultList:

```jsx
      {/* Emblems */}
      <EmblemPicker traits={traits} emblems={emblems} onToggle={toggleEmblem} />
```

- [ ] **Step 4: Commit**

```bash
git add v2/client/src/hooks/useScout.js v2/client/src/components/scout/EmblemPicker.jsx v2/client/src/components/scout/ScoutPanel.jsx
git commit -m "feat: emblem picker — adds +1 to selected traits in scout"
```

---

### Task 6: Score breakdown tooltip ("Why this comp?")

Shows how each factor contributes to the total score when hovering score in CompCard.

**Files:**
- Modify: `v2/server/src/algorithm/scorer.js` (add breakdown variant)
- Modify: `v2/server/src/algorithm/engine.js` (collect breakdown)
- Modify: `v2/server/src/mappers/scout-result.mapper.js`
- Modify: `v2/client/src/components/scout/CompCard.jsx`

- [ ] **Step 1: Add teamScoreBreakdown to scorer.js**

Add a new export after `teamScore` in `v2/server/src/algorithm/scorer.js`:

```javascript
export function teamScoreBreakdown(team, ctx) {
  const { level = 8, roleBalance = null } = team;
  const breakdown = { champions: 0, traits: 0, affinity: 0, synergy: 0, total: 0 };

  for (const champ of team.champions) {
    const pts = championScore(champ, ctx, level, roleBalance);
    breakdown.champions += champ.slotsUsed > 1 ? pts * champ.slotsUsed : pts;
  }

  const activeTraitApis = new Set(team.activeTraits.map(t => t.apiName));
  for (const trait of team.activeTraits) {
    const { score: tScore } = traitScore(trait, ctx);
    breakdown.traits += tScore;
  }

  for (const champ of team.champions) {
    breakdown.affinity += affinityBonus(champ, activeTraitApis, ctx);
  }

  const highBreakpoints = team.activeTraits.filter(t => {
    const sorted = [...(t.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    if (sorted.length <= 1 || sorted[0].minUnits <= 1) return false;
    let activeIdx = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (t.count >= sorted[i].minUnits) { activeIdx = i; break; }
    }
    return activeIdx >= 1;
  });
  breakdown.synergy = highBreakpoints.length * SCORING_CONFIG.weights.synergyBonus;

  breakdown.total = breakdown.champions + breakdown.traits + breakdown.affinity + breakdown.synergy;

  // Round all values
  for (const k of Object.keys(breakdown)) breakdown[k] = Math.round(breakdown[k] * 10) / 10;

  return breakdown;
}
```

- [ ] **Step 2: Collect breakdown in engine.js**

In `v2/server/src/algorithm/engine.js`, import `teamScoreBreakdown`:

```javascript
import { teamScore, teamScoreBreakdown } from '../algorithm/scorer.js';
```

In the enriched `.map()`, add breakdown alongside score:

```javascript
    const score = teamScore({ champions: team.champions, activeTraits, level, roleBalance: constraints.roleBalance ?? null }, scoringCtx);
    const breakdown = teamScoreBreakdown({ champions: team.champions, activeTraits, level, roleBalance: constraints.roleBalance ?? null }, scoringCtx);

    return {
      champions: team.champions,
      activeTraits,
      score,
      breakdown,
      level,
      slotsUsed: totalSlots,
    };
```

- [ ] **Step 3: Pass breakdown through mapper**

In `v2/server/src/mappers/scout-result.mapper.js`, add to the return:

```javascript
    breakdown: result.breakdown || null,
```

(Add after the `slotsUsed` line.)

- [ ] **Step 4: Show breakdown tooltip in CompCard**

In `v2/client/src/components/scout/CompCard.jsx`, update the score display:

```jsx
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
```

Replace the score span:

```jsx
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs font-mono text-foreground cursor-help">
                {comp.score.toFixed(1)} pts
              </span>
            </TooltipTrigger>
            {comp.breakdown && (
              <TooltipContent side="left" className="text-[10px] font-mono space-y-0.5">
                <p>Champions: {comp.breakdown.champions}</p>
                <p>Traits: {comp.breakdown.traits}</p>
                <p>Affinity: {comp.breakdown.affinity}</p>
                <p>Synergy: {comp.breakdown.synergy}</p>
                <p className="border-t border-border/50 pt-0.5 font-bold">Total: {comp.breakdown.total}</p>
              </TooltipContent>
            )}
          </Tooltip>
```

- [ ] **Step 5: Commit**

```bash
git add v2/server/src/algorithm/scorer.js v2/server/src/algorithm/engine.js v2/server/src/mappers/scout-result.mapper.js v2/client/src/components/scout/CompCard.jsx
git commit -m "feat: score breakdown tooltip — shows champion/trait/affinity/synergy split"
```

---

### Task 7: Loading skeleton + empty states

**Files:**
- Modify: `v2/client/src/components/scout/ResultList.jsx`
- Modify: `v2/client/src/components/scout/ScoutPanel.jsx`

- [ ] **Step 1: Add skeleton loading state to ResultList**

Replace the loading state in `v2/client/src/components/scout/ResultList.jsx`:

```jsx
import { Card, CardContent } from '@/components/ui/card';
import { CompCard } from './CompCard';

export function ResultList({ results, locked, loading }) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="bg-card/50 border-border/50 animate-pulse">
            <CardContent className="p-3 space-y-2">
              <div className="flex justify-between">
                <div className="h-3 w-6 bg-muted rounded" />
                <div className="h-3 w-16 bg-muted rounded" />
              </div>
              <div className="flex gap-1">
                {Array.from({ length: 8 }).map((_, j) => (
                  <div key={j} className="w-10 h-10 bg-muted rounded-md" />
                ))}
              </div>
              <div className="flex gap-1">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-5 w-16 bg-muted rounded" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        Lock champions to see team suggestions
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {results.map((comp, i) => (
        <CompCard key={i} comp={comp} index={i} locked={locked} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add v2/client/src/components/scout/ResultList.jsx
git commit -m "ui: loading skeleton for scout results"
```

---

### Task 8: Responsive layout + visual polish

**Files:**
- Modify: `v2/client/src/App.jsx`
- Modify: `v2/client/src/components/scout/ScoutPanel.jsx`
- Modify: `v2/client/src/components/champions/ChampionIcon.jsx`

- [ ] **Step 1: Responsive container in App.jsx**

In `v2/client/src/App.jsx`:

```jsx
import { ScoutPanel } from '@/components/scout/ScoutPanel';

export default function App() {
  return (
    <div className="min-h-screen bg-background px-3 py-4 sm:px-6 sm:py-6 max-w-6xl mx-auto">
      <ScoutPanel />
    </div>
  );
}
```

- [ ] **Step 2: Responsive champion icons**

In `v2/client/src/components/champions/ChampionIcon.jsx`, update size classes:

```javascript
  const sizeClasses = {
    sm: 'w-8 h-8 sm:w-10 sm:h-10',
    md: 'w-11 h-11 sm:w-14 sm:h-14',
    lg: 'w-14 h-14 sm:w-16 sm:h-16',
  };
```

- [ ] **Step 3: Responsive header in ScoutPanel**

In `v2/client/src/components/scout/ScoutPanel.jsx`, wrap header for mobile:

```jsx
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-base sm:text-lg font-mono font-bold tracking-tight">TFT Scout</h1>
        <div className="flex items-center gap-3">
```

- [ ] **Step 4: Commit**

```bash
git add v2/client/src/App.jsx v2/client/src/components/champions/ChampionIcon.jsx v2/client/src/components/scout/ScoutPanel.jsx
git commit -m "ui: responsive layout for mobile and desktop"
```
