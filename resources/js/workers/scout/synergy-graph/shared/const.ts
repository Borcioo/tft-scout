// resources/js/workers/scout/synergy-graph/shared/const.ts
//
// Named constants for the synergy-graph phases. Each constant is
// exported with a Why: comment so future tuners have context.

// @ts-nocheck

// Cost-based weights used by phaseCompanionSeeded to decide which
// anchor's top-companion list drives filler selection.
// Why: Fix 1E — 3/4-cost carries drive team composition in practice.
// 5-costs are spike units that rarely define comps. Index = cost - 1.
// Curve: [0.3, 0.5, 1.0, 0.95, 0.55] — 3-costs weigh most, 1-costs least.
export const FILLER_COST_WEIGHTS: readonly number[] = [0.3, 0.5, 1.0, 0.95, 0.55];

// Decay applied after each companion filler pick so flex fillers
// (Shen, Rhaast) surface once or twice without dominating the slate.
// Why: Fix 1E — tight lock runs had Shen in 30/30 comps pre-decay.
// 0.5 halves the pick weight each time, so a single filler's second
// pick already competes with fresh anchors.
export const FILLER_PICK_DECAY = 0.5;

// How many of each anchor's top companions are aggregated during
// cross-referenced filler ranking.
// Why: Fix 1E — top-10 gives enough depth to find overlap across
// multiple anchors without pulling in low-synergy tail companions.
export const FILLER_TOP_K_PER_ANCHOR = 10;

// Maximum total filler picks across all anchors per phase invocation.
// Why: Fix 1E — caps the candidate slate so buildOneTeam isn't called
// for marginal fillers that won't make it past diversify anyway.
export const FILLER_MAX_PICKS = 30;

// Number of anchors used to bootstrap filler ranking when no locked
// champions are present (non-locked runs).
// Why: Fix 1E — 6 anchors gives broad coverage of the unit-rating
// top tier without biasing toward a single carry archetype.
export const FILLER_BOOTSTRAP_ANCHORS = 6;

// Cap on filler picks sourced from a single 5-cost anchor.
// Why: Fix 1E throttle — prevents a single 5-cost from monopolising
// the filler slate when it has a deep top-10 companion list.
// max(actualMax5Cost, 3) is applied at call-site so comps with many
// locked 5-costs can exceed this floor.
export const FILLER_DEFAULT_FIVE_COST_CAP = 3;
