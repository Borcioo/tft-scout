import { describe, expect, it } from 'vitest';

import { pickSlate } from '../slate';

const rules = {
    topN: 4,
    dedupeOverlapPct: 0.75,
    familyOverlapPct: 0.5,
    perFamily: 2,
    perLabel: 2,
};
// Teams are strings of one-letter units, best first
const coreOf = (team: string) => new Set(team.split(''));
const pick = (ranked: string[], r = rules) => pickSlate(ranked, r, coreOf);

describe('pickSlate', () => {
    it('keeps two teams of a family, then moves on to other families', () => {
        // ABCDEFGH's variants share 5 of 8 (a family, not duplicates)
        const ranked = [
            'ABCDEFGH',
            'ABCDEXYZ',
            'ABCDEQRS',
            'IJKLMNOP',
            'QRSTUVWX',
        ];

        expect(pick(ranked)).toEqual([
            'ABCDEFGH',
            'ABCDEXYZ',
            'IJKLMNOP',
            'QRSTUVWX',
        ]);
    });

    it('fills a short slate from capped families, never with duplicates', () => {
        // 6 of 8 shared: a duplicate of the first
        const ranked = ['ABCDEFGH', 'ABCDEXYZ', 'ABCDEQRS', 'ABCDEFXY'];

        expect(pick(ranked)).toEqual(['ABCDEFGH', 'ABCDEXYZ', 'ABCDEQRS']);
    });

    it('names a trait in at most perLabel titles, then fills up', () => {
        // Unrelated units, but the first three are all "Solar" comps
        const label: Record<string, string[]> = {
            ABCDEFGH: ['Solar', 'Lunar'],
            IJKLMNOP: ['Solar'],
            QRSTUVWX: ['Lunar', 'Solar'],
            abcdefgh: ['Riftbeast'],
        };
        const slate = pickSlate(
            Object.keys(label),
            rules,
            coreOf,
            undefined,
            (team) => label[team],
        );

        expect(slate).toEqual(['ABCDEFGH', 'IJKLMNOP', 'abcdefgh', 'QRSTUVWX']);
    });

    it('polishes only into boards the slate allows', () => {
        // The second team would polish into a duplicate of the first
        const better: Record<string, string> = { IJKLMNOP: 'ABCDEFGP' };
        const slate = pickSlate(
            ['ABCDEFGH', 'IJKLMNOP'],
            rules,
            coreOf,
            (team, allowed) =>
                better[team] && allowed(better[team]) ? better[team] : team,
        );

        expect(slate).toEqual(['ABCDEFGH', 'IJKLMNOP']);
    });
});
