/**
 * Scorer — pure scoring functions.
 *
 * NO imports from DB, fetch, or services.
 * All data passed as arguments via context objects.
 *
 * @typedef {Object} ScoringContext
 * @property {Object<string, {score: number, games: number}>} unitRatings - keyed by apiName
 * @property {Object<string, Object<number, {score: number, games: number}>>} traitRatings - keyed by apiName → breakpointPosition
 * @property {Object<string, number>} styleScores - keyed by style name ('Bronze', 'Gold', etc.)
 * @property {Object<string, Array<{trait: string, breakpoint: number, avgPlace: number, games: number}>>} affinity - keyed by unitApiName
 */

import { SCORING_CONFIG } from './config';
import { collectAffinityMatches } from './synergy-graph/shared/affinity';
import { findActiveBreakpointIdx } from './synergy-graph/shared/breakpoints';

const { weights, breakpointMultiplier, breakEvenByTier, bronzeStackFactor, traitReward, provenBonus: PROVEN_CFG, dedupeOverlapPct, nearBreakpointBonus, minGamesForReliable, expectedStarPower, thresholds, maxTraitContribution } = SCORING_CONFIG;

const ROLE_CATEGORY = {
  ADCarry: 'dps', APCarry: 'dps', ADCaster: 'dps', APCaster: 'dps',
  ADReaper: 'dps', APReaper: 'dps', ADSpecialist: 'dps',
  ADTank: 'frontline', APTank: 'frontline',
  ADFighter: 'fighter', APFighter: 'fighter', HFighter: 'fighter',
};

/**
 * Count team roles. Fighters count as 0.5 frontline + 0.5 dps
 * (they flex between both in TFT).
 */
export function teamRoleBalance(champions: any) {
  let frontline = 0, dps = 0, fighter = 0;

  for (const c of champions) {
    const cat = (ROLE_CATEGORY as any)[c.role] || 'fighter';

    if (cat === 'frontline') {
frontline++;
} else if (cat === 'dps') {
dps++;
} else {
fighter++;
}
  }

  return { frontline, dps, fighter, effectiveFrontline: frontline + fighter * 0.5, effectiveDps: dps + fighter * 0.5 };
}

/**
 * Soft penalty for unbalanced teams.
 * Based on meta analysis: avg 3.3 frontline, 3.1 dps, 1.9 fighter.
 * 0 frontline or 0 dps never appears in winning comps.
 * Fighters are flex — they compensate for missing roles.
 */
export function roleBalancePenalty(champions: any) {
  const { effectiveFrontline, effectiveDps } = teamRoleBalance(champions);
  const teamSize = champions.length;

  if (teamSize === 0) {
return 0;
}

  let penalty = 0;

  // No frontline at all = heavy penalty (never works in meta)
  if (effectiveFrontline < 1) {
    penalty += 15;
  } else if (effectiveFrontline / teamSize < 0.2) {
    // Less than ~25% frontline = soft penalty
    penalty += 5;
  }

  // No DPS at all = heavy penalty
  if (effectiveDps < 1) {
    penalty += 15;
  } else if (effectiveDps / teamSize < 0.15) {
    // Less than ~20% DPS = soft penalty
    penalty += 5;
  }

  return penalty;
}

// ── Champion scoring ────────────────────────────

function starPowerFallback(cost: any, level: any) {
  const costIdx = Math.min(Math.max(Math.round(cost), 1), 5) - 1;
  const starPowers = (expectedStarPower as any)[level] || (expectedStarPower as any)[8];

  return (baseStat(cost) * starPowers[costIdx]) / 1.5;
}

function baseStat(cost: any) {
 return cost + 1; 
}

export function championScore(champion: any, ctx: any, level = 8) {
  const lookupApi = champion.baseApiName || champion.apiName;

  const unitRating = ctx.unitRatings?.[lookupApi];

  if (unitRating && unitRating.games >= minGamesForReliable) {
    return unitRating.score * weights.unitRating;
  }

  return starPowerFallback(champion.cost, level) / 6.0 * weights.championPower;
}

// ── Trait scoring ───────────────────────────────

export function traitScore(trait: any, ctx: any) {
  const { apiName, count, breakpoints } = trait;

  if (!breakpoints || breakpoints.length === 0) {
return { score: 0, near: null };
}

  const sorted = [...breakpoints].sort((a: any, b: any) => a.minUnits - b.minUnits);

  // Find active breakpoint
  const activeIdx = findActiveBreakpointIdx(count, sorted);
  const activeBp = activeIdx >= 0 ? sorted[activeIdx] : null;
  const nextBp = activeIdx >= 0 ? (sorted[activeIdx + 1] || null) : null;

  // Near-breakpoint detection
  let near = null;

  if (!activeBp) {
    if (count === sorted[0].minUnits - 1) {
      near = { current: count, next: sorted[0].minUnits, missing: 1 };
    }
  } else if (nextBp && nextBp.minUnits - count === 1) {
    near = { current: count, next: nextBp.minUnits, missing: 1 };
  }

  if (!activeBp) {
return { score: 0, near };
}

  // Unique traits (single champion)
  if (activeBp.minUnits === 1 && sorted.length === 1) {
    const rating = ctx.traitRatings?.[apiName]?.[1];
    const score = (rating && rating.games >= minGamesForReliable)
      ? rating.score * weights.uniqueTrait
      : 5;

    return { score, near };
  }

  // Regular traits — MetaTFT rating or style fallback
  const bpPosition = activeIdx + 1;
  const bpMult = breakpointMultiplier[Math.min(activeIdx, breakpointMultiplier.length - 1)];

  const rating = ctx.traitRatings?.[apiName]?.[bpPosition];
  let basePts;

  if (rating && rating.games >= minGamesForReliable) {
    // Non-linear reward: (neutralAvg - avgPlace)^exponent * weight * bpMult
    // Trait with avg >= neutralAvg (default 4.5) gets 0 pkt — no reward.
    // No negative penalty — orphan/filler penalties handle bad comps separately.
    const delta = traitReward.neutralAvg - rating.avgPlace;
    basePts = delta > 0
      ? Math.pow(delta, traitReward.exponent) * traitReward.weight * bpMult
      : 0;
  } else {
    // Style fallback only when no MetaTFT rating — keep old formula
    const styleName = activeBp.style || 'Bronze';
    const styleScore = ctx.styleScores?.[styleName] || 0.22;
    basePts = styleScore * weights.traitRating * bpMult;
  }

  // Near-breakpoint bonus + overflow penalty
  let adjust = 0;

  if (near) {
adjust = nearBreakpointBonus;
}

  if (nextBp && count > activeBp.minUnits) {
    const toNext = nextBp.minUnits - count;
    adjust = toNext === 1 ? nearBreakpointBonus : -(count - activeBp.minUnits) * weights.overflowPenalty;
  }

  return { score: basePts + adjust, near };
}

/**
 * Apply diminishing-returns stacking to Bronze (activeIdx === 0) trait
 * scores. Non-Bronze entries are returned unchanged.
 *
 * Given per-trait results [{apiName, activeIdx, rawScore, near}], returns
 * the same shape with `score` set (rawScore for non-Bronze, multiplied
 * for Bronze). Order preserved.
 */
export function applyBronzeStacking(
  results: Array<{ apiName: string; activeIdx: number; rawScore: number; near: boolean }>,
): Array<{ apiName: string; activeIdx: number; score: number; near: boolean }> {
  // 1. Collect Bronze with positions. Negative-score Bronze are excluded
  //    from the stacking queue — they shouldn't "take a slot" that
  //    attenuates later positive Bronze.
  const bronzeValues: Array<{ idx: number; rawScore: number }> = [];

  for (let i = 0; i < results.length; i++) {
    if (results[i].activeIdx === 0 && results[i].rawScore > 0) {
      bronzeValues.push({ idx: i, rawScore: results[i].rawScore });
    }
  }

  // 2. Sort descending by rawScore, apply factor^k
  bronzeValues.sort((a, b) => b.rawScore - a.rawScore);

  const scaledByOriginalIdx: Record<number, number> = {};
  for (let k = 0; k < bronzeValues.length; k++) {
    const { idx, rawScore } = bronzeValues[k];
    scaledByOriginalIdx[idx] = rawScore * Math.pow(bronzeStackFactor, k);
  }

  // 3. Emit in original order — scaled for Bronze-positive, raw for everything else
  return results.map((r, i) => ({
    apiName: r.apiName,
    activeIdx: r.activeIdx,
    near: r.near,
    score: scaledByOriginalIdx[i] ?? r.rawScore,
  }));
}

// ── Affinity bonus ──────────────────────────────

export function affinityBonus(champion: any, activeTraitApis: any, ctx: any) {
  // Collection delegated to shared helper (lookup key + filter + weight).
  // Aggregation (cap + sort + sum) stays here — scorer's defence against
  // trait-diverse comps getting unbounded affinity advantage is caller-specific.
  const matches = collectAffinityMatches(
    champion,
    activeTraitApis,
    ctx.affinity ?? {},
    { affinityMinGames: thresholds.affinityMinGames },
    { affinityBonus: weights.affinityBonus },
  );

  if (matches.length === 0) {
return 0;
}

  matches.sort((a: any, b: any) => b - a);
  const maxMatches = 3;
  let bonus = 0;

  for (let i = 0; i < Math.min(matches.length, maxMatches); i++) {
bonus += matches[i];
}

  return bonus;
}

// ── Dominant trait dampening ────────────────────

/**
 * When a team hits a breakpoint with exceptional real-world performance
 * (avgPlace < 3.5), individual champion strength matters less —
 * the trait itself carries the team. Returns a weight multiplier
 * for championScore (1.0 = normal, lower = dampened).
 */
function dominantTraitDampen(activeTraits: any, ctx: any) {
  let bestAvg = 8;

  for (const trait of activeTraits) {
    const sorted = [...(trait.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    const activeIdx = findActiveBreakpointIdx(trait.count, sorted);

    if (activeIdx < 0) {
continue;
}

    const bpPos = activeIdx + 1;
    const rating = ctx.traitRatings?.[trait.apiName]?.[bpPos];

    if (rating && rating.games >= thresholds.phaseMinGames && rating.avgPlace < bestAvg) {
      bestAvg = rating.avgPlace;
    }
  }

  // Scale: avgPlace 1.0 → weight 0.6, avgPlace 3.5 → weight 1.0
  if (bestAvg >= 3.5) {
return 1.0;
}

  return 0.6 + (bestAvg - 1.0) * 0.16;
}

// ── Filler penalty ──────────────────────────────

/**
 * Count "filler" champions — units whose removal wouldn't drop any
 * currently active trait breakpoint. Random boosters that ride along
 * on already-satisfied traits without carrying their own weight.
 *
 * A champion is critical (non-filler) if at least one of its traits is
 * active in the team AND removing this champion would drop that trait
 * to a lower breakpoint index. Uses breakpoint index (not just
 * activation) so overflow past a breakpoint counts as filler — e.g.
 * a 6th unit on a 5-unit active breakpoint contributes nothing.
 *
 * The 8-champion-team loop is O(8 * avgTraits * bpLookup) — negligible
 * vs the rest of the scorer.
 */
export function fillerCount(champions: any, activeTraitsByApi: Record<string, any>) {
  const traitCounts: Record<string, number> = {};

  for (const c of champions) {
    for (const t of c.traits) {
      traitCounts[t] = (traitCounts[t] || 0) + 1;
    }
  }

  const activeBpIdx = (trait: any, count: number) => {
    const bps = [...(trait.breakpoints || [])].sort((a: any, b: any) => a.minUnits - b.minUnits);

    return findActiveBreakpointIdx(count, bps);
  };

  let filler = 0;

  for (const c of champions) {
    let critical = false;

    for (const t of c.traits) {
      const trait = activeTraitsByApi[t];

      if (!trait) {
        continue;
      }

      const count = traitCounts[t];
      const curIdx = activeBpIdx(trait, count);

      if (curIdx < 0) {
        continue;
      }

      const withoutIdx = activeBpIdx(trait, count - 1);

      if (withoutIdx < curIdx) {
        critical = true;
        break;
      }
    }

    if (!critical) {
      filler++;
    }
  }

  return filler;
}

// ── Companion bonus ─────────────────────────────

export function companionBonus(team: any, ctx: any) {
  if (!ctx.companions) {
return 0;
}

  let bonus = 0;
  const teamApis = new Set(team.champions.map((c: any) => c.baseApiName || c.apiName));

  // Only count pairs where BOTH champions are in the team
  // Use a seen set to avoid double-counting A→B and B→A
  const seen = new Set();

  for (const champApi of teamApis) {
    const companionList = (ctx.companions as any)[champApi as any];

    if (!companionList) {
continue;
}

    for (const comp of companionList) {
      if (!teamApis.has(comp.companion)) {
continue;
}

      if (comp.games < thresholds.companionMinGames) {
continue;
}

      const pairKey = [champApi, comp.companion].sort((a: any, b: any) => a.localeCompare(b)).join('+');

      if (seen.has(pairKey)) {
continue;
}

      seen.add(pairKey);
      bonus += weights.affinityBonus * (1 - comp.avgPlace / 8);
    }
  }

  return bonus;
}

// ── Team scoring ────────────────────────────────

export function teamScore(team: any, ctx: any) {
  let score = 0;
  const { level = 8 } = team;

  // Detect dominant trait — a breakpoint so strong that individual champion
  // strength matters less (e.g. Meeple 10 avgPlace 1.44)
  const champScoreWeight = dominantTraitDampen(team.activeTraits, ctx);

  // Champion scores (dampened when a dominant trait carries the team)
  for (const champ of team.champions) {
    const pts = championScore(champ, ctx, level);
    score += (champ.slotsUsed > 1 ? pts * champ.slotsUsed : pts) * champScoreWeight;
  }

  // Trait scores — collect per-trait contribution (traitScore + proven +
  // synergy) atomically, then cap so no single trait can dominate. Without
  // the cap, one high-data trait (Vanguard:6 avg 3.32, Dark Star:9, etc.)
  // stacked all three mechanisms and produced ~60-80 pts while spread comps
  // topped out at ~25 per trait — that's what made 6V+3C impossible to
  // beat regardless of emblems/locks.
  const activeTraitApis = new Set(team.activeTraits.map((t: any) => t.apiName));

  const traitResults = team.activeTraits.map((trait: any) => {
    const sorted = [...(trait.breakpoints || [])].sort((a: any, b: any) => a.minUnits - b.minUnits);
    const activeIdx = findActiveBreakpointIdx(trait.count, sorted);
    const { score: rawScore, near } = traitScore(trait, ctx);
    return { apiName: trait.apiName, activeIdx, rawScore, near };
  });

  const perTraitContrib: Record<string, number> = {};
  for (const r of applyBronzeStacking(traitResults)) {
    perTraitContrib[r.apiName] = (perTraitContrib[r.apiName] ?? 0) + r.score;
  }

  // Proven team bonus — fold into per-trait contrib so it can be capped.
  for (const trait of team.activeTraits) {
    const sorted = [...(trait.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    const activeIdx = findActiveBreakpointIdx(trait.count, sorted);

    if (activeIdx < 0) {
continue;
}

    const rating = ctx.traitRatings?.[trait.apiName]?.[activeIdx + 1];

    if (rating && rating.games >= PROVEN_CFG.minGames && rating.avgPlace < PROVEN_CFG.maxAvgPlace) {
      let bonus = (PROVEN_CFG.maxAvgPlace - rating.avgPlace) * PROVEN_CFG.weight;

      if (rating.avgPlace < PROVEN_CFG.exponentialThreshold) {
        bonus += Math.pow(PROVEN_CFG.exponentialThreshold - rating.avgPlace, 2) * PROVEN_CFG.weight * PROVEN_CFG.quadMult;
      }

      perTraitContrib[trait.apiName] = (perTraitContrib[trait.apiName] ?? 0) + bonus;
    }
  }

  // Synergy concentration — also folded in so the 5-pt/trait bonus
  // counts toward the per-trait cap.
  const highBreakpoints = team.activeTraits.filter((t: any) => {
    const sorted = [...(t.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);

    if (sorted.length <= 1 || sorted[0].minUnits <= 1) {
return false;
}

    const activeIdx = findActiveBreakpointIdx(t.count, sorted);

    return activeIdx >= 1;
  });
  for (const hb of highBreakpoints) {
    perTraitContrib[hb.apiName] = (perTraitContrib[hb.apiName] ?? 0) + weights.synergyBonus;
  }

  // Apply cap per-trait and sum.
  for (const apiName of Object.keys(perTraitContrib)) {
    score += Math.min(perTraitContrib[apiName], maxTraitContribution);
  }

  // Affinity bonus — reward champions that are statistically proven with active traits
  for (const champ of team.champions) {
    score += affinityBonus(champ, activeTraitApis, ctx);
  }

  // Companion bonus — reward champion pairs that perform well together
  score += companionBonus(team, ctx);

  // Role balance penalty — penalize unrealistic compositions
  score -= roleBalancePenalty(team.champions);

  // Filler penalty — champions riding on already-satisfied breakpoints
  const activeTraitsByApi = Object.fromEntries(team.activeTraits.map((t: any) => [t.apiName, t]));
  score -= fillerCount(team.champions, activeTraitsByApi) * weights.fillerPenalty;

  return score;
}

export function teamScoreBreakdown(team: any, ctx: any) {
  const { level = 8 } = team;
  const breakdown = { champions: 0, traits: 0, affinity: 0, companions: 0, synergy: 0, balance: 0, total: 0 } as any;

  const champScoreWeight = dominantTraitDampen(team.activeTraits, ctx);

  for (const champ of team.champions) {
    const pts = championScore(champ, ctx, level);
    breakdown.champions += (champ.slotsUsed > 1 ? pts * champ.slotsUsed : pts) * champScoreWeight;
  }

  const activeTraitApis = new Set(team.activeTraits.map((t: any) => t.apiName));

  // Track per-trait totals so we can report the capping delta separately —
  // `traits`, `proven`, `synergy` keys keep their raw pre-cap values for
  // diagnostic clarity, and `traitCap` is a negative adjustment that
  // balances the total.
  const perTraitContrib: Record<string, number> = {};

  const traitResultsBd = team.activeTraits.map((trait: any) => {
    const sorted = [...(trait.breakpoints || [])].sort((a: any, b: any) => a.minUnits - b.minUnits);
    const activeIdx = findActiveBreakpointIdx(trait.count, sorted);
    const { score: rawScore, near } = traitScore(trait, ctx);
    return { apiName: trait.apiName, activeIdx, rawScore, near };
  });

  for (const r of applyBronzeStacking(traitResultsBd)) {
    breakdown.traits += r.score;
    perTraitContrib[r.apiName] = (perTraitContrib[r.apiName] ?? 0) + r.score;
  }

  for (const champ of team.champions) {
    breakdown.affinity += affinityBonus(champ, activeTraitApis, ctx);
  }

  const highBreakpoints = team.activeTraits.filter((t: any) => {
    const sorted = [...(t.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);

    if (sorted.length <= 1 || sorted[0].minUnits <= 1) {
return false;
}

    const activeIdx = findActiveBreakpointIdx(t.count, sorted);

    return activeIdx >= 1;
  });
  breakdown.companions = companionBonus(team, ctx);
  breakdown.synergy = highBreakpoints.length * SCORING_CONFIG.weights.synergyBonus;
  for (const hb of highBreakpoints) {
    perTraitContrib[hb.apiName] = (perTraitContrib[hb.apiName] ?? 0) + SCORING_CONFIG.weights.synergyBonus;
  }

  // Proven team bonus
  let provenBonus = 0;

  for (const trait of team.activeTraits) {
    const sorted = [...(trait.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    const activeIdx = findActiveBreakpointIdx(trait.count, sorted);

    if (activeIdx < 0) {
continue;
}

    const rating = ctx.traitRatings?.[trait.apiName]?.[activeIdx + 1];

    if (rating && rating.games >= PROVEN_CFG.minGames && rating.avgPlace < PROVEN_CFG.maxAvgPlace) {
      let bonus = (PROVEN_CFG.maxAvgPlace - rating.avgPlace) * PROVEN_CFG.weight;

      if (rating.avgPlace < PROVEN_CFG.exponentialThreshold) {
        bonus += Math.pow(PROVEN_CFG.exponentialThreshold - rating.avgPlace, 2) * PROVEN_CFG.weight * PROVEN_CFG.quadMult;
      }

      provenBonus += bonus;
      perTraitContrib[trait.apiName] = (perTraitContrib[trait.apiName] ?? 0) + bonus;
    }
  }

  breakdown.proven = provenBonus;

  // Compute cap delta — sum of (contrib - cap) for every trait that exceeds.
  // Reported as a negative breakdown key so the total adds up correctly.
  let traitCapReduction = 0;
  for (const apiName of Object.keys(perTraitContrib)) {
    const contrib = perTraitContrib[apiName];
    if (contrib > maxTraitContribution) {
      traitCapReduction -= (contrib - maxTraitContribution);
    }
  }
  breakdown.traitCap = traitCapReduction;

  breakdown.balance = -roleBalancePenalty(team.champions);

  const activeTraitsByApi = Object.fromEntries(team.activeTraits.map((t: any) => [t.apiName, t]));
  breakdown.filler = -fillerCount(team.champions, activeTraitsByApi) * weights.fillerPenalty;

  breakdown.total =
    breakdown.champions +
    breakdown.traits +
    breakdown.affinity +
    breakdown.companions +
    breakdown.synergy +
    breakdown.proven +
    breakdown.traitCap +
    breakdown.balance +
    breakdown.filler;

  for (const k of Object.keys(breakdown)) {
breakdown[k] = Math.round(breakdown[k] * 10) / 10;
}

  return breakdown;
}
