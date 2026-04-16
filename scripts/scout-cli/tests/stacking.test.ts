/**
 * Unit tests for applyBronzeStacking.
 *
 * Run: npx tsx scripts/scout-cli/tests/stacking.test.ts
 *      (prints "OK" on success, throws on failure)
 */

import { applyBronzeStacking } from '../../../resources/js/workers/scout/scorer';

function approx(actual: number, expected: number, tolerance = 0.001, label = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function same<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// 1. Single Bronze → full value
{
  const out = applyBronzeStacking([
    { apiName: 'A', activeIdx: 0, rawScore: 10, near: false },
  ]);
  approx(out[0].score, 10, 0.001, 'single bronze');
}

// 2. Three Bronze with factor 0.6 → 10 + 6 + 3.6 total
{
  const out = applyBronzeStacking([
    { apiName: 'A', activeIdx: 0, rawScore: 10, near: false },
    { apiName: 'B', activeIdx: 0, rawScore: 10, near: false },
    { apiName: 'C', activeIdx: 0, rawScore: 10, near: false },
  ]);
  const total = out.reduce((s, r) => s + r.score, 0);
  approx(total, 10 + 6 + 3.6, 0.001, '3 bronze');
}

// 3. Silver NOT affected
{
  const out = applyBronzeStacking([
    { apiName: 'S1', activeIdx: 1, rawScore: 20, near: false },
    { apiName: 'S2', activeIdx: 1, rawScore: 20, near: false },
    { apiName: 'B1', activeIdx: 0, rawScore: 10, near: false },
  ]);
  const silverTotal = out.filter((r) => r.activeIdx === 1).reduce((s, r) => s + r.score, 0);
  approx(silverTotal, 40, 0.001, 'silver untouched');
  const bronzeTotal = out.filter((r) => r.activeIdx === 0).reduce((s, r) => s + r.score, 0);
  approx(bronzeTotal, 10, 0.001, 'single bronze with silvers');
}

// 4. Order preserved in return
{
  const out = applyBronzeStacking([
    { apiName: 'A', activeIdx: 0, rawScore: 5, near: false },
    { apiName: 'B', activeIdx: 0, rawScore: 10, near: false },
    { apiName: 'C', activeIdx: 0, rawScore: 3, near: false },
  ]);
  same(out.map((r) => r.apiName), ['A', 'B', 'C'], 'order preserved');
  // But scaling applied by descending rawScore: B gets factor^0, A factor^1, C factor^2
  approx(out[1].score, 10, 0.001, 'B gets full');
  approx(out[0].score, 5 * 0.6, 0.001, 'A gets 60%');
  approx(out[2].score, 3 * 0.36, 0.001, 'C gets 36%');
}

// 5. Negative Bronze scores ignored in ranking
{
  const out = applyBronzeStacking([
    { apiName: 'Bad', activeIdx: 0, rawScore: -5, near: false },
    { apiName: 'Good', activeIdx: 0, rawScore: 10, near: false },
  ]);
  approx(out[0].score, -5, 0.001, 'negative unchanged');
  approx(out[1].score, 10, 0.001, 'first positive gets full (negative did not take slot)');
}

// 6. Empty input
{
  const out = applyBronzeStacking([]);
  same(out, [], 'empty');
}

// 7. Only non-Bronze
{
  const out = applyBronzeStacking([
    { apiName: 'G1', activeIdx: 2, rawScore: 30, near: false },
    { apiName: 'P1', activeIdx: 3, rawScore: 40, near: false },
  ]);
  approx(out[0].score, 30, 0.001, 'gold unchanged');
  approx(out[1].score, 40, 0.001, 'prismatic unchanged');
}

console.log('OK — all applyBronzeStacking tests passed');
