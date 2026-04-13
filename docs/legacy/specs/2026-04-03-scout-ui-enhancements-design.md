# Scout UI Enhancements (Phase 1)

## Goal

Improve scout mode results with better visual feedback using data we already have. No new endpoints or scoring changes.

## Features

### 1. Trait Affinity Display

Show the player's early game trait distribution above direction cards.

**Data source:** `earlyTraitAffinity` already returned by `/api/scout` response.

**Display:** Horizontal list of trait badges with count:
```
Your traits: Dark Star ×2  Brawler ×1  Vanguard ×1  Conduit ×1
```
- Count ≥2: green badge (strong affinity)
- Count 1: gray badge (weak)

**Location:** Between scout button and direction cards, in ResultsPanel when mode=scout.

### 2. Confidence Indicator

Badge on each direction card showing how safe/risky the pivot is.

**Logic:**
- **Strong** (green): `earlyUnitsKept >= 2 AND metaAvgPlace != null AND metaAvgPlace < 4.0`
- **Flex** (yellow): `earlyUnitsKept >= 1 AND (metaAvgPlace == null OR metaAvgPlace < 4.5)`
- **Risky** (red): everything else

**Display:** Small badge next to direction name: `1. Dark Star [Strong]`

### 3. Transition Preview

Expandable section in each ScoutResultCard showing level-by-level board.

**How it works:**
- "Show transitions" button at bottom of card
- On click: calls existing `/api/transitions` with `{ team: direction.endgameComp, targetLevel: endgameComp.champions.length }`
- Renders transitions using existing MiniTeam component pattern from TeamCard

**Reuses:** Same transitions endpoint and rendering logic as TeamCard's build path feature.

### 4. Safe Picks (Cross-Direction Analysis)

Section below all direction cards showing champions that appear in 2+ directions.

**Logic:**
- Collect all champion apiNames from each direction's endgameComp
- Find intersection (appear in 2+ directions)
- Display as "Safe picks — good in any direction:" with champion icons

**Location:** After the last ScoutResultCard in ResultsPanel.

## Files Changed

| File | Change |
|------|--------|
| `client/src/components/ScoutResultCard.jsx` | Add confidence badge, transition preview |
| `client/src/components/ResultsPanel.jsx` | Add trait affinity display, safe picks section |
| `client/src/i18n.jsx` | Add new translation keys |

## i18n Keys

```
'scout.your_traits': 'Twoje traity' / 'Your traits'
'scout.strong': 'Strong' / 'Strong'
'scout.flex': 'Flex' / 'Flex'
'scout.risky': 'Risky' / 'Risky'
'scout.safe_picks': 'Safe picks — dobre w kazdym kierunku' / 'Safe picks — good in any direction'
```

## Out of Scope (Phase 2)

- Item priority recommendations
- "What if" mode
- Multi-step scouting
