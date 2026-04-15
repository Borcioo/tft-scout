// resources/js/workers/scout/synergy-graph/phases/temperature-sweep.ts

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

export function phaseTemperatureSweep(ctx: PhaseContext): void {
  const { graph, teamSize, startChamps, context, rng, maxResults, results, addResult } = ctx;
  // Skip-on-locked moved to core.ts registry `skipWhen` predicate —
  // phaseLockedTraitSeeded already populated the lock-satisfying
  // space with targeted seeds, and temperatureSweep's random walks
  // almost never satisfy the filter on locked runs. On the Phase A
  // baseline this phase alone cost ~5 s per locked scenario.

  // Budget cut: was maxResults * 3 (1080 attempts on locked runs),
  // now maxResults * 1 (still plenty for diversity, still triggers
  // the early-exit when the result map has healthy size).
  const attempts = Math.max(maxResults, 60);

  for (let i = 0; i < attempts; i++) {
    const temp = 0.15 + (i / attempts) * 0.85;
    addResult(buildOneTeam(graph, teamSize, startChamps, context, temp, rng));

    if (results.size >= maxResults * 2) {
break;
}
  }
}
