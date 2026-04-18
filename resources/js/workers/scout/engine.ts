// @ts-nocheck
/**
 * Engine — orchestrates graph building + team finding.
 *
 * PURE — no DB, no fetch. Service layer provides all data.
 * This is the entry point for the algorithm layer.
 *
 * @typedef {Object} EngineInput
 * @property {object[]} champions - all champions (domain objects)
 * @property {object[]} traits - all traits with breakpoints (domain objects)
 * @property {object} scoringCtx - { unitRatings, traitRatings, styleScores, affinity }
 * @property {object} constraints - { lockedChampions, excludedChampions, lockedTraits, emblems, ... }
 * @property {string[][]} exclusionGroups - list of groups, each a list of
 *            mutually-exclusive champion apiNames (per base_champion_id)
 * @property {number} level - player level (5-10)
 * @property {number} topN - max results
 */

import { buildActiveTraits } from './active-traits';
import { filterCandidates, getLockedChampions, buildExclusionLookup } from './candidates';
import { SCORING_CONFIG } from './config';
import { buildHeroExclusionGroup } from './hero-exclusion';
import { teamScore, teamScoreBreakdown, teamRoleBalance } from './scorer';
import { startSpan } from './scout-profiler';
import { buildGraph, findTeams } from './synergy-graph';
import { buildTeamInsights } from './team-insights';
import { teamSizeBonus } from './trait-rules';

/**
 * Generate team compositions.
 *
 * @param {EngineInput} input
 * @returns {object[]} - array of { champions, activeTraits, score, level, slotsUsed }
 */
export function generate(input) {
  const _endGenerateTotal = startSpan('engine.generate.total');

  try {
    const {
      champions,
      traits,
      scoringCtx = {},
      constraints = {},
      exclusionGroups = [],
      level = 8,
      topN = 10,
      seed = 0,
      stale = false,
    } = input;

    // Normalise emblems to a flat string[] of trait apiNames, one entry
    // per physical emblem unit. Callers pass either legacy string[] or
    // the newer [{apiName, count}]; most downstream code
    // (buildActiveTraits, synergy-graph.applyEmblems, phaseDeepVertical)
    // iterates with `for (const e of emblems)` and indexes by `e`, which
    // silently breaks on object-shaped entries and swallows the emblem
    // entirely. Keep the result in a local instead of mutating the
    // caller's constraints so memoising callers aren't surprised by
    // in-place side effects on their input object.
    const normalizedEmblems = [];

    for (const e of constraints.emblems || []) {
      if (typeof e === 'string') {
        normalizedEmblems.push(e);
        continue;
      }

      const count = Math.max(1, Number(e?.count ?? 1));

      for (let i = 0; i < count; i++) {
        normalizedEmblems.push(e.apiName);
      }
    }

    // Append the hero mutual-exclusion group to whatever PHP gave us.
    // PHP emits base_champion_id variant groups; hero-exclusion is a
    // worker-side set rule (see hero-exclusion.ts for the TODO on
    // moving this to a proper set-rules hook later). If there are
    // fewer than 2 non-exempt hero variants, the helper returns [] so
    // no-op groups never reach buildExclusionLookup.
    const heroGroup = buildHeroExclusionGroup(champions);
    const effectiveExclusionGroups = heroGroup.length >= 2
      ? [...exclusionGroups, heroGroup]
      : exclusionGroups;

    // Defense in depth: strip any apiName that appears in BOTH lock and
    // ban lists. UI enforces mutual exclusion, but this protects against
    // callers (tests, CLI) that could pass conflicting lists — without
    // this, a locked+excluded champ would survive as a lock (because
    // `getLockedChampions` doesn't filter by exclusion) and end up in
    // every team despite the user's ban.
    const rawExcludedSet = new Set(constraints.excludedChampions || []);
    const sanitizedLocked = (constraints.lockedChampions || [])
      .filter((api: string) => !rawExcludedSet.has(api));

    // Filter candidates using exclusion groups
    const _endFilterCandidates = startSpan('engine.filterCandidates');
    const candidates = filterCandidates(champions, constraints, effectiveExclusionGroups);
    _endFilterCandidates();
    const rawLocked = getLockedChampions(champions, sanitizedLocked);

    // Hero variant → base swap. When the user locks a hero variant,
    // run the whole pipeline on its base champion instead. In TFT17
    // every hero has identical traits, cost and slot count as its base
    // — the only real difference is ability power — so graph edges,
    // affinity lookups (already via baseApiName), companion bonuses and
    // scorer weights all behave identically. Swap back after generation
    // so the user sees the hero variant they asked for in the final
    // comp. This avoids having to force-activate the hero's signature
    // trait (heroes are strong when built properly but still need a
    // sensible team composition — forcing tight trait breakpoints like
    // Stargazer@7 starves the team-builder); instead we let the normal
    // flow produce a good comp and simply mark which unit in it is the
    // hero variant.
    const championByApi = Object.fromEntries(champions.map(c => [c.apiName, c]));
    const heroSwapBackByBaseApi = new Map();
    const locked = rawLocked.map(c => {
      if (c.variant !== 'hero' || !c.baseApiName) {
        return c;
      }

      const base = championByApi[c.baseApiName];

      if (!base) {
        return c;
      }

      heroSwapBackByBaseApi.set(base.apiName, c);

      return base;
    });

    // Normalise lockedTraits to {apiName, minUnits} shape. Accept
    // both the object form and a bare string (legacy). A bare string
    // means "trait must be active at all", so minUnits = 1.
    const traitLocks = (constraints.lockedTraits || []).map(t =>
      typeof t === 'string' ? { apiName: t, minUnits: 1 } : t,
    );

    // Tight-trait-lock auto-promotion: when a requested trait lock
    // requires exactly as many units as the accessible pool has, every
    // satisfying champion is mandatory — promote them all into
    // `locked` so the team-builder seeds from this mandatory core and
    // only explores filler combinations for the remaining slots.
    //
    // Without this, `traitLocks` only runs as a post-filter: phases
    // build generic teams that ignore the lock, almost none satisfy
    // it, and the filter throws nearly everything out (ShieldTank:6
    // with a 6-champion pool produced just 3 unique comps because
    // the vast majority of raw teams never hit the trait breakpoint).
    //
    // For loose locks (pool > minUnits) we leave the filter as-is —
    // auto-promoting a subset would arbitrarily pin specific champs
    // over others; that case wants a dedicated trait-seeded phase.
    const excludedSet = new Set(constraints.excludedChampions || []);
    const lockedApiSet = new Set(locked.map(c => c.apiName));

    // Per-trait max-achievable count, honouring exclusion groups AND
    // slotsUsed. Base + enhanced Mecha are mutually exclusive (same
    // base_champion_id group), so a naive `filter.length` overcounts:
    // 6 Mecha champs in the catalogue but only 3 can field at once.
    // Each can be base (1 slot) or enhanced (2 slots) → best case 3×2=6.
    //
    // Algorithm: group champs by exclusion group (singletons for
    // anything outside a group); pick the member with max slotsUsed
    // from each; sum.
    const exclusionMemberMap: Record<string, string[]> = {};
    for (const group of effectiveExclusionGroups) {
      for (const member of group) exclusionMemberMap[member] = group;
    }
    const maxTraitAchievable = (lockApi: string): { count: number; picks: string[] } => {
      const groupBest: Record<string, { slots: number; api: string }> = {};
      for (const c of champions) {
        if (c.variant === 'hero') continue;
        if (excludedSet.has(c.apiName)) continue;
        if (!c.traits.includes(lockApi)) continue;
        const groupKey = exclusionMemberMap[c.apiName]?.slice().sort().join('|') ?? c.apiName;
        const slots = c.slotsUsed ?? 1;
        if (!groupBest[groupKey] || slots > groupBest[groupKey].slots) {
          groupBest[groupKey] = { slots, api: c.apiName };
        }
      }
      let count = 0;
      const picks: string[] = [];
      for (const v of Object.values(groupBest)) {
        count += v.slots;
        picks.push(v.api);
      }
      return { count, picks };
    };

    const anyLockImpossible = traitLocks.some(lock => {
      const { count } = maxTraitAchievable(lock.apiName);
      const emblemBoost = normalizedEmblems.filter(e => e === lock.apiName).length;
      return count + emblemBoost < lock.minUnits;
    });

    const _endTightAutoPromote = startSpan('engine.tightAutoPromote');

    for (const lock of traitLocks) {
      const { count, picks } = maxTraitAchievable(lock.apiName);
      const emblemBoost = normalizedEmblems.filter(e => e === lock.apiName).length;

      // Tight lock = the best-case slot sum exactly equals minUnits
      // (after emblems). No slack → pin the picks from each exclusion
      // group so phases actually produce the target composition
      // instead of shuffling around it. For Mecha:6 this locks the
      // three _enhanced champions directly.
      if (count + emblemBoost !== lock.minUnits) {
        continue;
      }

      for (const api of picks) {
        if (lockedApiSet.has(api)) {
          continue;
        }
        const champ = champions.find(c => c.apiName === api);
        if (champ) {
          locked.push(champ);
          lockedApiSet.add(api);
        }
      }
    }

    _endTightAutoPromote();

    // Team size is a SLOT budget (level + trait-rule bonuses). Board
    // capacity is N slots; enhanced Mecha count 2 so a team can have
    // fewer unique units than its slot budget. Team-builder honours
    // the budget natively (see shared/team-builder.ts) — no more
    // subtracting extra slots for locked enhanced up front.
    const lockedTraitBonus = teamSizeBonus(traitLocks);
    const effectiveTeamSize = level + lockedTraitBonus;

    // Build graph from eligible champions (locked + candidates).
    // Auto-promoted tight-lock champions may have been in `candidates`
    // already; dedupe via apiName to avoid passing the same node twice
    // into buildGraph (which would inflate its edge count).
    const lockedApiSetForGraph = new Set(locked.map(c => c.apiName));
    const eligibleChampions = [
      ...locked,
      ...candidates.filter(c => !lockedApiSetForGraph.has(c.apiName)),
    ];
    const exclusionLookup = buildExclusionLookup(effectiveExclusionGroups);

    const _endBuildGraph = startSpan('engine.buildGraph');
    const graph = buildGraph(eligibleChampions, traits, scoringCtx, exclusionLookup);
    _endBuildGraph();

    // Find teams — request extra so diversify has enough candidates.
    // When trait locks are active, widen the search even more because
    // the post-generation filter below drops teams that miss the
    // requirement, and the raw pool needs to be big enough to survive.
    //
    // Search budget is CONSTANT — it does not scale with topN. Phase
    // cutoffs inside findTeams early-exit on `results.size >= maxResults * N`,
    // so if the budget tracked topN, a small topN would cut phases
    // short and miss strong comps (rank-1 would then shift as topN
    // changes for the same seed — not what callers expect). Keeping
    // the budget constant means rank-k is deterministic for a given
    // seed regardless of topN, and runtime is predictable. topN only
    // slices the final sorted list.
    const SEARCH_BUDGET = 40;
    const searchMultiplier = (constraints.max5Cost != null ? 5 : 3)
      * (traitLocks.length > 0 ? 3 : 1);

    const _endFindTeams = startSpan('engine.findTeams');
    const rawTeams = findTeams(graph, {
      teamSize: effectiveTeamSize,
      startChamps: locked.map(c => c.apiName),
      maxResults: SEARCH_BUDGET * searchMultiplier,
      level,
      emblems: normalizedEmblems,
      excludedTraits: constraints.excludedTraits || [],
      excludedChampions: constraints.excludedChampions || [],
      max5Cost: constraints.max5Cost ?? null,
      seed,
      lockedTraits: traitLocks,
    });
    _endFindTeams();

    // Enrich results with active traits and re-score with full scorer
    const _endEnrichLoop = startSpan('engine.enrichLoop');
    const enriched = rawTeams.map(team => {
      let totalSlots = 0;

      for (const c of team.champions) {
  totalSlots += c.slotsUsed || 1;
  }

      const _endBAT = startSpan('engine.enrichLoop.buildActiveTraits');
      const activeTraits = buildActiveTraits(team.champions, traits, normalizedEmblems);
      _endBAT();

      // Re-score with full scorer
      const _endTS = startSpan('engine.enrichLoop.teamScore');
      const score = teamScore({
        champions: team.champions,
        activeTraits,
        level,
        roleBalance: constraints.roleBalance ?? null,
      }, scoringCtx);
      _endTS();

      const _endTSB = startSpan('engine.enrichLoop.teamScoreBreakdown');
      const breakdown = teamScoreBreakdown({ champions: team.champions, activeTraits, level, roleBalance: constraints.roleBalance ?? null }, scoringCtx);
      _endTSB();

      const roles = teamRoleBalance(team.champions);

      return {
        champions: team.champions,
        activeTraits,
        score,
        breakdown,
        level,
        slotsUsed: totalSlots,
        roles: { frontline: roles.frontline, dps: roles.dps, fighter: roles.fighter },
      };
    });
    _endEnrichLoop();

    // Filter out comps that exceed slot budget OR that miss any
    // player-requested trait lock. Trait locks are a hard filter —
    // every active trait in the locked list must hit at least its
    // requested minUnits count.
    //
    // Slot budget = level + teamSizeBonus(activeTraits). Trait rules
    // like Mecha @ 6 expand the board one slot per-comp; re-compute
    // per result so non-locked comps that happen to hit the bonus
    // breakpoint get the benefit too.
    const minFrontline = constraints.minFrontline ?? 0;
    const minDps = constraints.minDps ?? 0;
    const applyRoleFilter = minFrontline > 0 || minDps > 0;

    const _endValidCompsFilter = startSpan('engine.validCompsFilter');
    const validComps = enriched.filter(r => {
      const maxSlots = level + teamSizeBonus(r.activeTraits);
      if (r.slotsUsed > maxSlots) {
        return false;
      }

      for (const lock of traitLocks) {
        const active = r.activeTraits.find(t => t.apiName === lock.apiName);

        if (!active || active.count < lock.minUnits) {
          return false;
        }
      }

      if (applyRoleFilter) {
        if (!r.roles) {
          return false;
        }

        const fl = r.roles.frontline + 0.5 * r.roles.fighter;
        const dps = r.roles.dps + 0.5 * r.roles.fighter;

        if (fl < minFrontline) {
          return false;
        }

        if (dps < minDps) {
          return false;
        }
      }

      return true;
    });
    _endValidCompsFilter();

    // Fix 7: topN guarantee. The hard filter above drops any team
    // that misses a trait lock or a role-balance minimum. For
    // heavy-constraint queries this can leave far fewer than topN
    // survivors. The spec's topN contract says the user always sees
    // exactly topN unless constraints are mathematically impossible
    // — low-scoring variants are acceptable, short slates are not.
    //
    // Backfill the gap by pulling the highest-scoring teams from
    // `enriched` that were rejected by the filter, marking each
    // with `breakdown.relaxed = 1` so the UI can label them as
    // closest-fit alternatives. Sorting by score alone is the
    // simplest reasonable heuristic — iterate later if the
    // ordering feels wrong.
    if (validComps.length < topN && !anyLockImpossible) {
      const validKeys = new Set(validComps.map(t => t.champions.map(c => c.apiName).sort().join(',')));
      const backfillCandidates = enriched
        .filter(r => {
          const maxSlots = level + teamSizeBonus(r.activeTraits);
          if (r.slotsUsed > maxSlots) {
            return false;
          }

          // Trait locks are a HARD contract — never backfill with teams
          // that miss them. User saw "low-ranked comps without my locked
          // trait" because backfill only checked slot budget, not locks.
          // Role-balance / slot relaxations are still fine to backfill
          // (softer UX signals).
          for (const lock of traitLocks) {
            const active = r.activeTraits.find(t => t.apiName === lock.apiName);
            if (!active || active.count < lock.minUnits) {
              return false;
            }
          }

          const key = r.champions.map(c => c.apiName).sort().join(',');

          return !validKeys.has(key);
        })
        .sort((a, b) => b.score - a.score);

      for (const team of backfillCandidates) {
        if (validComps.length >= topN) {
          break;
        }

        if (team.breakdown && typeof team.breakdown === 'object') {
          team.breakdown.relaxed = 1;
        }

        validComps.push(team);
      }
    }

    // Variant diversification: when the whole topN slate is all-base
    // but enhanced-variant teams exist in the scored pool, swap the
    // LAST comp for the best available enhanced alternative so the
    // user sees both playstyles at a glance.
    //
    // Rationale: enhanced (slotsUsed=2) champions represent a separate
    // playstyle (carry-focused with Marauder/Brawler wrap for Urgot
    // Enhanced etc.) that raw stats underscore — MetaTFT lumps
    // base+enhanced plays under the base apiName, so the scorer can't
    // tell them apart. Showing at least one enhanced option per slate
    // is a UX guarantee, not a scoring override: the displaced team is
    // always the LOWEST-ranked, top picks stay untouched.
    //
    // No score threshold — enhanced comps are legitimately lower on
    // raw score due to their narrower trait spread; the whole point is
    // to surface them anyway. Marked `variantPick: 1` in breakdown so
    // the UI can badge them.
    const hasEnhancedInTop = validComps.some(t =>
      t.champions?.some(c => c.variant === 'enhanced'),
    );
    if (!hasEnhancedInTop && validComps.length > 1) {
      const enhancedCandidate = enriched
        .filter(r => {
          if (!r.champions?.some(c => c.variant === 'enhanced')) return false;
          const maxSlots = level + teamSizeBonus(r.activeTraits);
          if (r.slotsUsed > maxSlots) return false;
          // Respect trait-lock hard filter.
          for (const lock of traitLocks) {
            const active = r.activeTraits.find(t => t.apiName === lock.apiName);
            if (!active || active.count < lock.minUnits) return false;
          }
          return true;
        })
        .sort((a, b) => b.score - a.score)[0];

      if (enhancedCandidate) {
        const key = enhancedCandidate.champions.map(c => c.apiName).sort().join(',');
        const existingKeys = new Set(
          validComps.map(t => t.champions.map(c => c.apiName).sort().join(',')),
        );
        if (!existingKeys.has(key)) {
          if (enhancedCandidate.breakdown && typeof enhancedCandidate.breakdown === 'object') {
            enhancedCandidate.breakdown.variantPick = 1;
          }
          validComps[validComps.length - 1] = enhancedCandidate;
        }
      }
    }

    // Meta-comp match detection — annotate results that match known meta comps
    const _endMetaCompMatch = startSpan('engine.metaCompMatch');
    const metaComps = scoringCtx.metaComps || [];

    if (metaComps.length > 0) {
      // Meta badge rules:
      // 1. Archetype match: team has at most 1 champion missing vs meta
      //    core (i.e. overlap >= meta.units.length - 1). Counting diffs
      //    instead of % because for 8-unit comps 90% = 100% (granularity).
      // 2. Meta must actually be meta (avgPlace < 4.5). Published "meta"
      //    clusters include bad placements too; we don't want to mark
      //    avg 5.34 comps as Meta.
      // 3. Prefer the meta with the most overlap (not just "first match").
      const MAX_DIFF = 1;
      const META_MAX_AVG = 4.5;

      for (const comp of validComps) {
        const teamApis = new Set(comp.champions.map(c => c.baseApiName || c.apiName));

        let best: { meta: (typeof metaComps)[number]; overlap: number } | null = null;
        for (const meta of metaComps) {
          if (meta.avgPlace >= META_MAX_AVG) {
            continue;
          }

          const overlap = meta.units.filter(u => teamApis.has(u)).length;
          const missing = meta.units.length - overlap;

          if (missing > MAX_DIFF) {
            continue;
          }

          if (!best || overlap > best.overlap) {
            best = { meta, overlap };
          }
        }

        if (best) {
          comp.metaMatch = {
            name: best.meta.name,
            avgPlace: best.meta.avgPlace,
            games: best.meta.games,
            overlap: best.overlap,
            total: best.meta.units.length,
          };
        }
      }
    }

    _endMetaCompMatch();

    // Compute batch median so the `noMetaMatch` concern rule can
    // decide which teams look experimental (below median) vs just
    // variants of a meta build.
    const scoresAsc = validComps.map(t => t.score).sort((a, b) => a - b);
    const batchMedianScore = scoresAsc.length === 0
      ? 0
      : scoresAsc[Math.floor(scoresAsc.length / 2)];

    // stale lives on ScoutContext, not ScoringContext — fold it in
    // so the staleData concern rule can read it through the same
    // object as the rest of the scoring data.
    const ctxForInsights = { ...scoringCtx, stale };

    const _endInsights = startSpan('engine.insightsLoop');

    for (const team of validComps) {
      team.insights = buildTeamInsights(team, ctxForInsights, batchMedianScore);
    }

    _endInsights();

    // Sort by final score and dedupe topN by core champion overlap.
    // Without this, top results are permutations of the same comp with
    // 1-2 champs swapped. Threshold from config — 0.75 = 6/8 shared = dup.
    validComps.sort((a, b) => b.score - a.score);

    const dedupeThreshold = SCORING_CONFIG.dedupeOverlapPct;
    const finalComps: typeof validComps = [];
    for (const team of validComps) {
      if (finalComps.length >= topN) {
        break;
      }

      const teamApis = new Set(team.champions.map((c: any) => c.baseApiName || c.apiName));
      const isDup = finalComps.some((accepted) => {
        const acceptedApis = new Set(accepted.champions.map((c: any) => c.baseApiName || c.apiName));
        let shared = 0;
        for (const api of teamApis) {
          if (acceptedApis.has(api)) {
            shared++;
          }
        }
        const size = Math.max(teamApis.size, acceptedApis.size);
        return size > 0 && shared / size >= dedupeThreshold;
      });

      if (!isDup) {
        finalComps.push(team);
      }
    }

    // Swap base champions back to their hero variants for any hero
    // the caller locked. Traits, cost and slotsUsed are identical so
    // the rest of the scoring stays correct, and the consumer sees
    // the hero variant they asked for.
    if (heroSwapBackByBaseApi.size > 0) {
      for (const comp of finalComps) {
        comp.champions = comp.champions.map(c => heroSwapBackByBaseApi.get(c.apiName) ?? c);
      }
    }

    return finalComps;
  } finally {
    _endGenerateTotal();
  }
}
