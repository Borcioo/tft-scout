// resources/js/workers/scout/synergy-graph/phases/companion-seeded.ts

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import { pickCompanionFillers } from '../../synergy-graph';

export function phaseCompanionSeeded({ graph, teamSize, startChamps, context, rng, addResult }) {
  const picks = pickCompanionFillers(graph, context, startChamps);

  for (const filler of picks) {
    const seeds = [...startChamps, filler];

    addResult(buildOneTeam(graph, teamSize, seeds, context, 0.2 + rng() * 0.3, rng));
  }
}
