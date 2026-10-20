/**
 * Unit tests for data-driven trait mechanics: per-champion trait amounts
 * (Set 18 Lux forms ×2, Elder Dragon ×2 Riftbeast, Set 17 Mecha Enhanced)
 * and breakpoint team-size bonuses (Riftbeast 10 → +2, Mecha 6 → +1).
 *
 * Run: npx tsx scripts/scout-cli/tests/trait-mechanics.test.ts
 *      (prints "OK" on success, throws on failure)
 */

import assert from 'node:assert/strict';

import { buildActiveTraits } from '../../../resources/js/workers/scout/active-traits';
import { traitAmount } from '../../../resources/js/workers/scout/trait-amount';
import { buildTeamSizeRules, teamSizeBonus } from '../../../resources/js/workers/scout/trait-rules';

const riftbeast = {
  apiName: 'Riftbeast',
  name: 'Riftbeast',
  breakpoints: [
    { position: 1, minUnits: 3, teamSizeBonus: 0 },
    { position: 2, minUnits: 5, teamSizeBonus: 0 },
    { position: 3, minUnits: 7, teamSizeBonus: 0 },
    { position: 4, minUnits: 10, teamSizeBonus: 2 },
  ],
};
const coven = {
  apiName: 'Coven',
  name: 'Coven',
  breakpoints: [
    { position: 1, minUnits: 3 },
    { position: 2, minUnits: 4 },
  ],
};

// 1. traitAmount defaults to 1, reads overrides
{
  assert.equal(traitAmount({}, 'Coven'), 1);
  assert.equal(traitAmount(null, 'Coven'), 1);
  assert.equal(traitAmount({ traitAmounts: { Coven: 2 } }, 'Coven'), 2);
  assert.equal(traitAmount({ traitAmounts: { Coven: 2 } }, 'Avatar'), 1);
}

// 2. Lux (Coven) counts twice for Coven
{
  const team = [
    { apiName: 'C1', traits: ['Coven'] },
    { apiName: 'LuxCoven', traits: ['Coven', 'Avatar'], traitAmounts: { Coven: 2 } },
  ];
  const active = buildActiveTraits(team, [coven], []);
  const c = active.find((t: any) => t.apiName === 'Coven');
  assert.equal(c?.count, 3, 'Lux (Coven) + 1 Coven unit = 3');
  assert.equal(c?.activeBreakpoint, 3);
}

// 3. Elder Dragon counts 2 Riftbeast
{
  const team = [
    { apiName: 'Elder', traits: ['Riftbeast'], traitAmounts: { Riftbeast: 2 } },
    { apiName: 'R1', traits: ['Riftbeast'] },
  ];
  const active = buildActiveTraits(team, [riftbeast], []);
  assert.equal(active.find((t: any) => t.apiName === 'Riftbeast')?.count, 3);
}

// 4. Team-size bonus only from the granting breakpoint up
{
  const rules = buildTeamSizeRules([riftbeast, coven]);
  assert.deepEqual(Object.keys(rules), ['Riftbeast']);
  assert.equal(teamSizeBonus([{ apiName: 'Riftbeast', count: 9 }], rules), 0);
  assert.equal(teamSizeBonus([{ apiName: 'Riftbeast', count: 10 }], rules), 2);
  assert.equal(teamSizeBonus([{ apiName: 'Riftbeast', minUnits: 11 }], rules), 2);
  assert.equal(teamSizeBonus([{ apiName: 'Coven', count: 7 }], rules), 0);
  assert.equal(teamSizeBonus(null, rules), 0);
}

console.log('OK — all trait mechanics tests passed');
