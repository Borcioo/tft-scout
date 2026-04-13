/**
 * Champion Service — loads champions and traits from DB through mappers.
 */

import { fromDb as mapChampion } from '../mappers/champion.mapper.js';
import { fromDb as mapTrait } from '../mappers/trait.mapper.js';

export function createChampionService(db) {
  const champQuery = db.prepare(`
    SELECT c.*, GROUP_CONCAT(t.apiName) as traitApiNames, GROUP_CONCAT(t.name) as traitNames
    FROM champions c
    LEFT JOIN champion_traits ct ON ct.championId = c.id
    LEFT JOIN traits t ON t.id = ct.traitId
    GROUP BY c.id
  `);

  const traitQuery = db.prepare('SELECT * FROM traits');
  const breakpointQuery = db.prepare(`
    SELECT tb.*, ts.name as styleName
    FROM trait_breakpoints tb
    JOIN trait_styles ts ON ts.id = tb.styleId
    WHERE tb.traitId = ?
    ORDER BY tb.position
  `);

  const exclusionQuery = db.prepare('SELECT * FROM exclusion_groups');

  return {
    getAllChampions() {
      return champQuery.all().map(mapChampion);
    },

    getAllTraits() {
      return traitQuery.all().map(tr => mapTrait(tr, breakpointQuery.all(tr.id)));
    },

    getExclusionGroups() {
      return exclusionQuery.all();
    },
  };
}
