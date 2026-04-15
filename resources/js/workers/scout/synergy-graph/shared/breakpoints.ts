// resources/js/workers/scout/synergy-graph/shared/breakpoints.ts
//
// findActiveBreakpointIdx — single source of truth for "which trait
// breakpoint is currently active given a unit count". Pure, no state.
//
// Consumers: team-insights.ts, scorer.ts, core.ts/diversifyResults,
// any phase that walks breakpoints. Before this extraction there
// were 4+ copies across the scout worker with micro-variations
// (some `<` some `<=`, same semantics). This is the canonical form.

/**
 * Returns the index of the highest breakpoint whose minUnits is <=
 * `count`, or -1 if `count` is below the first breakpoint.
 *
 * `breakpoints` MUST be sorted ascending by minUnits. Caller is
 * responsible for the sort; this function trusts the contract.
 */
export function findActiveBreakpointIdx(
  count: number,
  breakpoints: readonly { minUnits: number }[],
): number {
  let idx = -1;
  for (let i = 0; i < breakpoints.length; i++) {
    if (count >= breakpoints[i].minUnits) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}
