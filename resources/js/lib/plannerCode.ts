/**
 * TFT in-game Team Planner code generator.
 *
 * Format: "02" + 10 slots (3-char lowercase hex each) + "TFTSet<N>"
 * Each slot = champion's `plannerCode` (int from CDragon
 * `team_planner_code`) in hex, padded to 3 chars. Empty slots = "000".
 *
 * Stable between sets — only the suffix number changes. The version
 * byte / team size / hex width are the only hardcoded parts and would
 * only need updating if Riot changes the encoding scheme.
 */

const VERSION_BYTE = '02';
const TEAM_SIZE = 10;
const SLOT_HEX_CHARS = 3;
const EMPTY_SLOT = '0'.repeat(SLOT_HEX_CHARS);
const SUFFIX_PREFIX = 'TFTSet';
const DEFAULT_SET_NUMBER = '17';

type ChampLike = {
    apiName?: string;
    plannerCode?: number | null;
};

/**
 * Build planner code from a list of champions.
 * Returns null if no champion has a planner code.
 */
export function generatePlannerCode(
    champions: ChampLike[],
    setVersion?: string | null,
): string | null {
    if (!champions || champions.length === 0) return null;

    const setNumber =
        (setVersion ?? deriveSetVersion(champions) ?? '').replace(/^TFT/, '') ||
        DEFAULT_SET_NUMBER;

    const slots: string[] = [];
    for (const c of champions) {
        if (c.plannerCode == null) continue;
        slots.push(c.plannerCode.toString(16).padStart(SLOT_HEX_CHARS, '0'));
        if (slots.length >= TEAM_SIZE) break;
    }

    if (slots.length === 0) return null;

    while (slots.length < TEAM_SIZE) slots.push(EMPTY_SLOT);

    return VERSION_BYTE + slots.join('') + SUFFIX_PREFIX + setNumber;
}

/**
 * Detect set from champ apiName prefix (e.g. "TFT17_Briar" → "TFT17").
 * Returns null if no match.
 */
export function deriveSetVersion(champions: ChampLike[]): string | null {
    if (!champions || champions.length === 0) return null;
    for (const c of champions) {
        const match = (c.apiName ?? '').match(/^(TFT\d+)_/);
        if (match) return match[1];
    }
    return null;
}
