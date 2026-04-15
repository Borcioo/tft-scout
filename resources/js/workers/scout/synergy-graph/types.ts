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
  exclusionLookup: Record<string, Set<string>>;
};

// Phase contract. All phases implement this signature post-Task 14.
// Every phase takes the single `ctx` bag and destructures what it
// needs at the top of its body. The field list is the union of
// parameters the 10 phase bodies destructure — add to it only if
// a new phase needs a field none of the existing phases read.
export type PhaseContext = {
  graph: Graph;
  teamSize: number;
  startChamps: any[];
  context: any;
  rng: any;
  maxResults: number;
  results: any;
  addResult: (team: any) => void;
  excludedSet: Set<string>;
  excludedTraits: string[];
  emblems: string[];
};

export type Phase = (ctx: PhaseContext) => void;

export type PhaseEntry = {
  name: string;
  phase: Phase;
  skipWhen?: (ctx: PhaseContext) => boolean;
};
