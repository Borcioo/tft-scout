// resources/js/workers/scout/synergy-graph/types.ts
//
// Shared types for the synergy-graph folder. Kept minimal —
// only types referenced by 2+ files in the folder go here.

// Graph is the precomputed champion-pair synergy structure used by
// findTeams. Shape matches exactly what buildGraph returns in graph.ts.
// Fields reflect the actual monolith return value — do not rename them
// (refactor is behavior-preserving).
export type Graph = {
  nodes: Record<string, any>;
  traitMap: Record<string, string[]>;
  adjacency: Record<string, any[]>;
  traitBreakpoints: Record<string, number[]>;
  traitStyles: Record<string, Record<number, string>>;
  scoringCtx: any;
  exclusionLookup: Record<string, string[]>;
};

// Placeholder for Task 14. Phase/PhaseContext are added when core.ts
// is written. Do not add them here yet — keeps Task 1 minimal.
