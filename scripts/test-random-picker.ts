/**
 * Smoke test for resources/js/lib/random-picker.ts.
 * No Vitest/Jest in this repo — we use tsx + node:assert.
 * Run: npx tsx scripts/test-random-picker.ts
 */
import assert from 'node:assert/strict';
import {
    pickRandomCarry,
    pickRandomTrait,
    pickRandomFromTeams,
} from '../resources/js/lib/random-picker';
import type { Champion, Trait, ScoredTeam } from '../resources/js/workers/scout/types';

function champ(partial: Partial<Champion> & { apiName: string }): Champion {
    return {
        apiName: partial.apiName,
        name: partial.apiName,
        cost: partial.cost ?? 1,
        traits: partial.traits ?? [],
        traitNames: partial.traitNames ?? [],
        slotsUsed: partial.slotsUsed ?? 1,
        baseApiName: partial.baseApiName ?? null,
        variant: partial.variant ?? null,
        role: partial.role ?? null,
        damageType: partial.damageType ?? null,
        roleCategory: partial.roleCategory ?? null,
        icon: '',
        abilityIcon: null,
        plannerCode: null,
    };
}

// Deterministic RNG: returns values from a fixed queue (wraps around).
function fixedRng(values: number[]): () => number {
    let i = 0;
    return () => {
        const v = values[i % values.length];
        i++;
        return v;
    };
}

// pickRandomCarry: tier=4 with 3 candidates, first 4-cost frontline gets dropped,
// the remaining two are DPS/fighter. RNG=0 → pick index 0 of the filtered pool.
{
    const pool: Champion[] = [
        champ({ apiName: 'Aatrox', cost: 4, roleCategory: 'frontline' }),
        champ({ apiName: 'Jinx', cost: 4, roleCategory: 'dps' }),
        champ({ apiName: 'Kayn', cost: 4, roleCategory: 'fighter' }),
        champ({ apiName: 'Sona', cost: 3, roleCategory: 'dps' }),
    ];
    const picked = pickRandomCarry(pool, 4, fixedRng([0]));
    assert.equal(picked?.apiName, 'Jinx', 'tier=4 + rng=0 should pick first DPS-category 4-cost');

    const picked2 = pickRandomCarry(pool, 'random', fixedRng([0.99]));
    // 3 candidates after filter (Jinx, Kayn, Sona); floor(0.99 * 3) = 2 → Sona.
    assert.equal(picked2?.apiName, 'Sona');

    const emptyPool = pickRandomCarry([], 4, fixedRng([0]));
    assert.equal(emptyPool, null, 'empty pool returns null');

    const noMatch = pickRandomCarry(
        [champ({ apiName: 'Aatrox', cost: 4, roleCategory: 'frontline' })],
        4,
        fixedRng([0]),
    );
    assert.equal(noMatch, null, 'only frontline 4-costs → null');
}

// pickRandomTrait: drops `unique` traits, samples from public ones.
{
    const traits: Trait[] = [
        { apiName: 'Stargazer', name: 'Stargazer', category: 'unique', breakpoints: [{ position: 0, minUnits: 1, maxUnits: null, style: null }], icon: '' },
        { apiName: 'Vanguard', name: 'Vanguard', category: 'public', breakpoints: [{ position: 0, minUnits: 2, maxUnits: null, style: 'Bronze' }, { position: 1, minUnits: 4, maxUnits: null, style: 'Silver' }], icon: '' },
        { apiName: 'Sniper', name: 'Sniper', category: 'public', breakpoints: [{ position: 0, minUnits: 2, maxUnits: null, style: 'Bronze' }], icon: '' },
    ];
    const picked = pickRandomTrait(traits, fixedRng([0]));
    assert.deepEqual(picked, { apiName: 'Vanguard', minUnits: 2 });

    const picked2 = pickRandomTrait(traits, fixedRng([0.99]));
    // 2 candidates after filter; floor(0.99 * 2) = 1 → Sniper.
    assert.equal(picked2?.apiName, 'Sniper');

    const onlyUnique = pickRandomTrait([traits[0]], fixedRng([0]));
    assert.equal(onlyUnique, null, 'no public traits → null');
}

// pickRandomFromTeams: uniform pick, rng=0 → index 0, rng≈1 → last index.
{
    const teams: ScoredTeam[] = [
        { champions: [], activeTraits: [], score: 10, breakdown: null, level: 9, slotsUsed: 8, roles: null, metaMatch: null, insights: null },
        { champions: [], activeTraits: [], score: 5, breakdown: null, level: 9, slotsUsed: 8, roles: null, metaMatch: null, insights: null },
        { champions: [], activeTraits: [], score: 1, breakdown: null, level: 9, slotsUsed: 8, roles: null, metaMatch: null, insights: null },
    ];
    assert.equal(pickRandomFromTeams(teams, fixedRng([0]))?.score, 10);
    assert.equal(pickRandomFromTeams(teams, fixedRng([0.99]))?.score, 1);
    assert.equal(pickRandomFromTeams([], fixedRng([0])), null);
}

console.log('random-picker smoke tests passed');
