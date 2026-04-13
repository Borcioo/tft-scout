# TFT Scout Algorithm — Technical Overview

## What it does

Given a set of locked champions and constraints (level, max 5-costs, emblems), the algorithm generates optimal team compositions scored by real match statistics from MetaTFT.

It works like an automated player — instead of manually browsing MetaTFT, filtering comps, and comparing builds, the scout does this programmatically: analyzing statistics, discovering hidden synergies, and generating diverse team proposals in milliseconds.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           SCORING CONTEXT               │
                    │                                         │
                    │  unitRatings    — per champion avg       │
                    │                   placement & win rate   │
                    │  traitRatings   — per trait breakpoint   │
                    │                   performance            │
                    │  affinity       — which traits a         │
                    │                   champion wins with     │
                    │  companions     — which champions        │
                    │                   perform well together  │
                    │  metaComps      — known meta team comps  │
                    │  styleScores    — fallback scores per    │
                    │                   breakpoint tier        │
                    │                                         │
                    │  Loaded for ALL champions via bulk       │
                    │  SELECT (~6k rows, ~17ms).              │
                    └──────────┬──────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                      SYNERGY GRAPH                           │
│                                                              │
│  Nodes: all eligible champions                               │
│                                                              │
│  Edges (two types):                                          │
│    ├─ Trait edges: shared traits                             │
│    │   (Urgot ──Brawler── Cho'Gath)                         │
│    └─ Companion edges: real game co-occurrence               │
│       (MF ~~companion~~ Shen)                                │
│       No shared traits, but statistically win together.      │
│       Created from MetaTFT Explorer data.                    │
│                                                              │
│  Constraints baked into traversal:                           │
│    ├─ Exclusion groups (MF variants, Mecha normal/enhanced)  │
│    └─ Max 5-cost limit (enforced during building, not after) │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                   8-PHASE EXPLORATION                         │
│                                                              │
│  Eight modular exploration strategies run in sequence.        │
│  Each phase is an independent function receiving phaseCtx.   │
│  All scored by the same MetaTFT data — the data decides     │
│  which approach produces the best results.                   │
│                                                              │
│  Phase 1: Temperature sweep                                  │
│    Greedy graph expansion from locked champions.             │
│    Low temp = exploit (pick best neighbor).                   │
│    High temp = explore (pick from wider pool).                │
│    Generates diverse baseline teams.                         │
│                                                              │
│  Phase 2: Trait-seeded                                       │
│    For each shared trait, seed 2 random members              │
│    + locked champions → expand.                              │
│    Explores different trait directions.                       │
│                                                              │
│  Phase 3: Deep vertical                                      │
│    For each trait with strong high-breakpoint data            │
│    (avg placement ≤ configured threshold), force enough      │
│    members to hit that breakpoint → fill rest naturally.     │
│    Emblem-aware: counts emblems toward breakpoint, but       │
│    caps by non-trait champions available as holders.          │
│                                                              │
│    Two sub-strategies per trait:                              │
│    a) Breakpoint targeting — seed exactly enough members     │
│       to hit each breakpoint.                                │
│    b) All-in — seed every available member of the trait.     │
│       Let scoring decide if extra members beat fillers.      │
│                                                              │
│  Phase 4: Pair synergy                                       │
│    Find pairs of strong traits and seed both together.       │
│    Discovers multi-vertical compositions that Phase 3        │
│    (single vertical) would miss.                             │
│                                                              │
│  Phase 5: Companion-seeded                                   │
│    Seed from all champions that statistically perform         │
│    well with the locked champion. No trait or cost filter    │
│    — any champion that wins together is a valid seed.        │
│    Uses real game co-occurrence data, not trait analysis.     │
│                                                              │
│  Phase 6: Meta-comp seeded                                   │
│    Use known meta compositions from MetaTFT as seeds.        │
│    Not served as-is — algorithm builds from them like        │
│    any other seed. Requires overlap with locked champions.   │
│                                                              │
│  Phase 7: Crossover                                          │
│    Take top 10 results, breed new teams by combining         │
│    non-locked members from pairs of parents.                 │
│    Parent A contributes first half, parent B second half.    │
│    Discovers combinations that no single phase found.        │
│                                                              │
│  Phase 8: Hill climbing                                      │
│    Take top 3 results, try swapping each non-locked member   │
│    for a better graph neighbor. Keep if score improves.      │
│    Polishes results from previous phases.                    │
│                                                              │
│  Each phase → buildOneTeam() → scored → deduplicated         │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    TEAM BUILDING (per attempt)                │
│                                                              │
│  Locked champions are separated from phase seeds.            │
│  Locked ALWAYS stay — they never get dropped.                │
│  Seeds fill remaining budget (teamSize - locked).            │
│                                                              │
│  Start with locked + seeds                                   │
│           │                                                  │
│           ▼                                                  │
│  While team < teamSize:                                      │
│    ├─ Score all graph neighbors of current team              │
│    │   (includes both trait edges AND companion edges)        │
│    ├─ If < 15 candidates, also score non-neighbors           │
│    ├─ Skip 5-costs if max5Cost limit reached                 │
│    ├─ Skip exclusion group conflicts                         │
│    ├─ Penalize excluded traits (-15 score)                   │
│    ├─ Weighted random pick (temperature controls greed)       │
│    └─ Add picked champion, update exclusions & 5-cost count  │
│                                                              │
│  Candidate scoring (quickScore):                             │
│    Σ unit ratings + Σ trait breakpoint values                 │
│    + near-breakpoint bonus                                   │
│    + synergy bonus (2nd+ breakpoint)                         │
│    + affinity bonus (top 3 per champion, capped)             │
│    + companion bonus (pairs in team)                         │
│    - cost penalty (based on shop odds at player level)       │
│    - overflow penalty (wasted units above breakpoint)         │
│    - orphan penalty (champion with zero active trait overlap) │
│                                                              │
│  Emblem handling: applyEmblems() caps usable emblems by      │
│  non-trait champions available to hold them. Prevents        │
│  phantom breakpoints (e.g. DS 9 when only 2 holders exist). │
│                                                              │
│  Mecha Enhanced: counts 2× for Mecha trait in quickScore     │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    FINAL SCORING                             │
│                                                              │
│  Each generated team is re-scored with full scorer:          │
│                                                              │
│  championScore (per champion):                               │
│    ├─ MetaTFT unit rating × 10.0 weight                     │
│    ├─ OR star power fallback if no data                      │
│    ├─ Enhanced Mecha: score × slotsUsed                     │
│    └─ Weight dampened when dominant trait carries the team    │
│       (0.6–1.0 scale based on best active breakpoint avg)    │
│                                                              │
│  traitScore (per active trait):                              │
│    ├─ MetaTFT breakpoint rating × 15.0 weight               │
│    │   adjusted by break-even threshold:                     │
│    │     1st breakpoint: 0.25 (low bar — easy to splash)    │
│    │     2nd+ breakpoint: 0.40 (must justify 4+ slots)      │
│    │     4th+ breakpoint: 0.20 (prismatic is worth it)      │
│    ├─ × breakpoint multiplier [1.0, 1.3, 1.8, 2.5]         │
│    ├─ + near-breakpoint bonus (+2.0 if 1 unit away)         │
│    ├─ - overflow penalty (wasted units × 5.0)               │
│    └─ OR style-based fallback if no MetaTFT data            │
│                                                              │
│  provenBonus (per active trait):                             │
│    When a breakpoint has exceptional real-world results       │
│    (avgPlace < 4.0), direct bonus: (4.0 - avg) × 15.0      │
│    Exponential boost for avgPlace < 2.5:                     │
│      + (2.5 - avg)² × 15.0 × 2                             │
│    Example: Dark Star 9 (avg 1.18) → 72+ bonus pts          │
│    This ensures truly exceptional compositions rank highly   │
│    despite having cheap/weak individual champions.           │
│                                                              │
│  affinityBonus (per champion):                               │
│    For each active trait that this champion statistically     │
│    wins with → +3.0 × (1 - avgPlace/8)                     │
│    Capped at top 3 matches per champion to prevent           │
│    trait-diverse comps from dominating deep verticals.        │
│                                                              │
│  companionBonus (per team):                                  │
│    For each unique champion pair (both in team)              │
│    confirmed as strong in real games                         │
│    → +3.0 × (1 - avgPlace/8)                               │
│    Deduplicated: A↔B counted once, not twice.               │
│                                                              │
│  orphanPenalty (per champion):                               │
│    -20.0 if none of the champion's traits are active         │
│    in the team. Unique traits (1-unit breakpoint) are        │
│    exempt — they self-activate (e.g., Rhaast, Vex).         │
│                                                              │
│  synergyBonus:                                               │
│    +5.0 per trait at 2nd+ breakpoint                        │
│                                                              │
│  roleBalancePenalty:                                          │
│    0 frontline or 0 dps = -15, very low = -5               │
│    Fighters count as 0.5 frontline + 0.5 dps (flex role)    │
│                                                              │
│  metaMatch detection:                                        │
│    If ≥70% of a meta comp's units are in the team,          │
│    annotate with meta name, avgPlace, games.                 │
│    Informational only — does not affect score.               │
│                                                              │
│  total = Σ champions×dampen + Σ traits + proven              │
│          + affinity + companions + synergy                    │
│          - roleBalancePenalty - orphanPenalty                 │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                 VALIDATION & DIVERSIFICATION                 │
│                                                              │
│  Filter:                                                     │
│    ├─ Reject teams exceeding slot budget (level)             │
│    ├─ Reject teams with exclusion group conflicts            │
│    └─ Reject teams exceeding max 5-cost limit               │
│                                                              │
│  Diversify (emblem-aware):                                   │
│    Group by dominant trait pair + breakpoint level.           │
│    Trait counts include emblems (capped by holders).          │
│    E.g., Meeple@0 (bronze) and Meeple@3 (unique)           │
│    are different groups — both get a slot in results.        │
│    Keep best team per group first → fill with remaining.     │
│                                                              │
│  Output: ranked teams with full score breakdown + roles      │
│    { champions, activeTraits, score,                         │
│      breakdown: { champions, traits, affinity, companions,   │
│                   synergy, proven, balance, orphan },         │
│      roles: { frontline, dps, fighter },                     │
│      metaMatch: { name, avgPlace, games } | null,            │
│      slotsUsed, level }                                      │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                       INSIGHTS                               │
│                                                              │
│  Separate from team generation — analyzes game state         │
│  and generates actionable tips.                              │
│                                                              │
│  Emblem opportunities:                                       │
│    For each emblem trait, find highest achievable breakpoint. │
│    Report: trait, breakpoint, avgPlace, min level needed,    │
│    how many more champions to collect.                       │
│    Priority: high (avg < 3.0), medium (< 4.0), low.         │
│                                                              │
│  Vertical potential:                                         │
│    When 3+ locked champions share a trait, suggest the       │
│    next breakpoint if data supports it.                      │
│                                                              │
│  Output: array of insight objects, sorted by priority.        │
└──────────────────────────────────────────────────────────────┘
```

## Scoring weights

| Factor | Weight | Description |
|--------|--------|-------------|
| `unitRating` | 10.0 | MetaTFT champion performance (0-1 score from avg placement) |
| `traitRating` | 15.0 | MetaTFT trait breakpoint performance (0-1 score) |
| `uniqueTrait` | 12.0 | Single-champion traits (5-cost carries like Morgana, Shen) |
| `championPower` | 3.0 | Fallback when no MetaTFT data available |
| `synergyBonus` | 5.0 | Per trait at 2nd+ breakpoint (rewards depth) |
| `overflowPenalty` | 5.0 | Per wasted unit above current breakpoint |
| `affinityBonus` | 3.0 | Champion-trait combo confirmed by real game data (top 3 per champion) |
| `orphanPenalty` | 20.0 | Champion with zero overlap with active traits |

Breakpoint multipliers: `[1.0, 1.3, 1.8, 2.5]` — higher breakpoints get exponentially scaled reward, but only if MetaTFT data supports them.

## Exploration thresholds

All configurable in `config.js`:

| Threshold | Value | Used by |
|-----------|-------|---------|
| `deepVerticalMaxAvg` | 4.75 | Phase 3: max avgPlace to force a breakpoint |
| `pairSynergyMaxAvg` | 4.75 | Phase 4: traits considered "strong" for pairing |
| `companionMaxAvg` | 5.0 | Phase 5: companion seeds |
| `companionMinGames` | 50 | Companion data reliability |
| `affinityMinGames` | 10 | Affinity data reliability |
| `phaseMinGames` | 30 | Phase 3/4 trait evaluation |

## Anti-bias mechanisms

**Affinity cap (top 3 per champion):** Without capping, affinity scales linearly with the number of active traits. A diverse comp with 12 active traits would get 3-4× the affinity bonus of a deep vertical comp — even if the vertical comp wins more games. Capping at top 3 matches per champion levels the playing field.

**Dominant trait dampening:** When a team hits an exceptional breakpoint (avgPlace < 3.5), individual champion strength matters less — the trait itself carries. ChampionScore weight is reduced proportionally (0.6 at avg 1.0, 1.0 at avg 3.5+). This prevents cheap-but-essential vertical champions from being undervalued.

**Proven team bonus (exponential):** Breakpoints with avgPlace < 4.0 get a direct bonus. Below 2.5, the bonus grows exponentially: `(2.5 - avg)² × weight × 2`. Dark Star 9 (avg 1.18) gets ~72 bonus pts vs ~3 pts for a 3.8 avg trait. This ensures truly exceptional compositions outrank diverse comps with individually stronger champions.

**Orphan penalty:** Champions with zero trait contribution are penalized (-20). Unique traits (1-unit breakpoint) are exempt since they self-activate.

**Companion deduplication:** Each pair counted once (A↔B), both must be in team.

**Emblem cap:** `applyEmblems()` ensures emblems only count when a non-trait champion is available to hold them. Prevents phantom breakpoints.

## Special mechanics

**Mecha Enhanced:** Takes 2 board slots, counts 2× for Mecha trait breakpoint. Scored as `championScore × slotsUsed`. Normal and Enhanced versions of the same champion are mutually exclusive.

**Miss Fortune variants:** 3 separate champions (Conduit/Challenger/Replicator) with different trait sets. Mutually exclusive via exclusion groups.

**Exclusion groups:** Enforced at 3 levels — candidate filtering, team building traversal, and final validation.

**Locked champion protection:** Locked champions are separated from phase seeds in `buildOneTeam`. Locked ALWAYS remain — only seeds are subject to budget truncation.

**Meta-comp match detection:** If ≥70% of a known meta comp's units appear in a generated team, annotated with META badge (name, avgPlace, games). Informational — does not affect score.

## Data dependencies

The algorithm is **pure** — no database, no API calls, no side effects. All data arrives via `scoringCtx`:

| Data | Source | Used by |
|------|--------|---------|
| `unitRatings` | MetaTFT | championScore |
| `traitRatings` | MetaTFT | traitScore, provenBonus, Phase 3/4 |
| `affinity` | MetaTFT Explorer | affinityBonus |
| `companions` | MetaTFT Explorer | companionBonus + graph edges |
| `metaComps` | MetaTFT comps API | Phase 6 seeding + match detection |
| `styleScores` | CDragon | traitScore fallback |
| champions, traits | CDragon | Graph nodes, breakpoints |
| exclusionGroups | CDragon + set hooks | Conflict prevention |

All external API URLs are configured via environment variables (`server/.env`).

`scoringCtx` is built by `ratings.service.js` — bulk loads all data (~17ms).

## Key files

```
algorithm/
  ├─ engine.js          — entry point: generate(input) → results
  │                       meta-comp match detection, role balance output
  ├─ synergy-graph.js   — graph construction + 8 modular phase functions
  │                       buildGraph(), findTeams(), buildOneTeam()
  │                       applyEmblems(), diversifyResults()
  ├─ scorer.js          — championScore (with dampening), traitScore,
  │                       provenBonus, affinityBonus, companionBonus,
  │                       orphanPenalty, roleBalancePenalty
  ├─ insights.js        — generateInsights(): emblem opportunities,
  │                       vertical potential tips
  ├─ candidates.js      — filterCandidates, buildExclusionLookup,
  │                       getLockedChampions
  └─ config.js          — SCORING_CONFIG: weights, multipliers,
                           thresholds, expectedStarPower
```

All files are **pure functions** — zero database imports, zero API calls. Data is passed in as plain JS objects.
