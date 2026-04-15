// resources/js/workers/scout/synergy-graph/index.ts
//
// Public entry point for the synergy-graph folder.
// Re-exports the names engine.ts imports: buildGraph, findTeams.
// Post-Task 14: the legacy synergy-graph.ts monolith is deleted;
// findTeams lives in ./core and buildGraph in ./graph. engine.ts's
// `import from './synergy-graph'` resolves here automatically via
// folder/index.ts resolution.

export { buildGraph } from './graph';
export { findTeams } from './core';
