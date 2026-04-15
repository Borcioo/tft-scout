// resources/js/workers/scout/synergy-graph/index.ts
//
// Public entry point for the synergy-graph folder.
// Re-exports the names engine.ts imports: buildGraph, findTeams.
// As phases/core move into the folder, this file grows re-exports.
// After Task 14 it is the only public surface of the folder.

export { buildGraph } from './graph';

// findTeams still lives in the legacy synergy-graph.ts monolith
// during Tasks 1-13. Task 14 moves it to ./core and this line
// changes to `export { findTeams } from './core';`.
export { findTeams } from '../synergy-graph';
