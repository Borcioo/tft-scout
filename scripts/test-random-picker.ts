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

// pickRandomTrait: drops `unique` traits + drops traits whose smallest
// breakpoint already requires an emblem. minUnits = MAX reachable breakpoint.
{
    const traits: Trait[] = [
        { apiName: 'Stargazer', name: 'Stargazer', category: 'unique', breakpoints: [{ position: 0, minUnits: 1, maxUnits: null, style: null }], icon: '' },
        { apiName: 'Vanguard', name: 'Vanguard', category: 'public', breakpoints: [{ position: 0, minUnits: 2, maxUnits: null, style: 'Bronze' }, { position: 1, minUnits: 4, maxUnits: null, style: 'Silver' }], icon: '' },
        { apiName: 'Sniper', name: 'Sniper', category: 'public', breakpoints: [{ position: 0, minUnits: 2, maxUnits: null, style: 'Bronze' }], icon: '' },
        { apiName: 'Rare', name: 'Rare', category: 'public', breakpoints: [{ position: 0, minUnits: 6, maxUnits: null, style: 'Prismatic' }], icon: '' },
    ];

    // 4 Vanguard + 2 Sniper + 1 Rare champs → Vanguard reaches bp 4,
    // Sniper reaches bp 2, Rare's only bp (6) needs emblems → dropped.
    const champsFull: Champion[] = [
        champ({ apiName: 'V1', traits: ['Vanguard'] }),
        champ({ apiName: 'V2', traits: ['Vanguard'] }),
        champ({ apiName: 'V3', traits: ['Vanguard'] }),
        champ({ apiName: 'V4', traits: ['Vanguard'] }),
        champ({ apiName: 'S1', traits: ['Sniper'] }),
        champ({ apiName: 'S2', traits: ['Sniper'] }),
        champ({ apiName: 'R1', traits: ['Rare'] }),
    ];

    const picked = pickRandomTrait(traits, champsFull, fixedRng([0]));
    // 2 candidates after filter (Vanguard bp=4, Sniper bp=2). rng=0 → Vanguard.
    assert.deepEqual(picked, { apiName: 'Vanguard', minUnits: 4 });

    const picked2 = pickRandomTrait(traits, champsFull, fixedRng([0.99]));
    // floor(0.99 * 2) = 1 → Sniper at its max reachable bp=2.
    assert.deepEqual(picked2, { apiName: 'Sniper', minUnits: 2 });

    // Vanguard pool shrinks to 2 → only bp=2 fits; bp=4 needs an emblem.
    const champsThin: Champion[] = [
        champ({ apiName: 'V1', traits: ['Vanguard'] }),
        champ({ apiName: 'V2', traits: ['Vanguard'] }),
    ];
    const thin = pickRandomTrait(traits, champsThin, fixedRng([0]));
    assert.deepEqual(thin, { apiName: 'Vanguard', minUnits: 2 });

    // Mecha-like: 3 unique bases × enhanced variants (slotsUsed=2) →
    // reach bp=6 without emblems.
    const mechaTrait: Trait = { apiName: 'Mecha', name: 'Mecha', category: 'public', breakpoints: [{ position: 0, minUnits: 3, maxUnits: null, style: 'Bronze' }, { position: 1, minUnits: 6, maxUnits: null, style: 'Gold' }], icon: '' };
    const mechaChamps: Champion[] = [
        champ({ apiName: 'M1', baseApiName: 'M1', traits: ['Mecha'], slotsUsed: 1 }),
        champ({ apiName: 'M1_enh', baseApiName: 'M1', traits: ['Mecha'], slotsUsed: 2 }),
        champ({ apiName: 'M2', baseApiName: 'M2', traits: ['Mecha'], slotsUsed: 1 }),
        champ({ apiName: 'M2_enh', baseApiName: 'M2', traits: ['Mecha'], slotsUsed: 2 }),
        champ({ apiName: 'M3', baseApiName: 'M3', traits: ['Mecha'], slotsUsed: 1 }),
        champ({ apiName: 'M3_enh', baseApiName: 'M3', traits: ['Mecha'], slotsUsed: 2 }),
    ];
    const mecha = pickRandomTrait([mechaTrait], mechaChamps, fixedRng([0]));
    assert.deepEqual(mecha, { apiName: 'Mecha', minUnits: 6 }, 'Mecha:6 reachable via 3 enhanced ×2 slots');

    // Hero variants excluded from the count.
    const heroTrait: Trait = { apiName: 'Lone', name: 'Lone', category: 'public', breakpoints: [{ position: 0, minUnits: 1, maxUnits: null, style: 'Bronze' }], icon: '' };
    const heroOnly: Champion[] = [
        champ({ apiName: 'HeroA', variant: 'hero', traits: ['Lone'] }),
    ];
    const heroSkip = pickRandomTrait([heroTrait], heroOnly, fixedRng([0]));
    assert.equal(heroSkip, null, 'trait with only hero-variant champs → no candidate');

    const onlyUnique = pickRandomTrait([traits[0]], champsFull, fixedRng([0]));
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
