import { Head, Link } from '@inertiajs/react';
import { ArrowLeft, Info, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import AppLayout from '@/layouts/app-layout';
import { cn } from '@/lib/utils';

type ChampionTrait = {
    api_name: string;
    name: string;
    category: string;
};

type AbilityStat = {
    name: string;
    value: number[];
    // Calculated entries are computed by SpellCalculationEvaluator from
    // mSpellCalculations (e.g. TotalDamage = sum of ADDamage + APDamage
    // scaled by ratios). Raw data values have no `kind` and come straight
    // from DataValues in the spell bin.
    kind?: 'calculated';
};

type Champion = {
    id: number;
    api_name: string;
    name: string;
    cost: number;
    role: string | null;
    damage_type: string | null;
    role_category: string | null;
    is_playable: boolean;
    variant_label: string | null;
    base_champion_api_name: string | null;
    stats: {
        hp: number;
        armor: number;
        magic_resist: number;
        attack_damage: number;
        attack_speed: number;
        mana: number;
        start_mana: number;
        range: number;
        crit_chance: number;
        crit_multiplier: number;
    };
    ability_desc: string | null;
    ability_stats: AbilityStat[];
    traits: ChampionTrait[];
};

type Props = {
    champion: Champion;
    variants: Champion[];
    rating: null; // Phase B placeholder — will become { score, tier, avg_place, ... }
};

/** Cost colors matching in-game TFT unit borders */
const COST_STYLES: Record<
    number,
    { border: string; text: string; gradient: string }
> = {
    1: {
        border: 'border-zinc-400',
        text: 'text-zinc-300',
        gradient: 'from-zinc-900/70',
    },
    2: {
        border: 'border-green-500',
        text: 'text-green-300',
        gradient: 'from-green-900/70',
    },
    3: {
        border: 'border-blue-500',
        text: 'text-blue-300',
        gradient: 'from-blue-900/70',
    },
    4: {
        border: 'border-purple-500',
        text: 'text-purple-300',
        gradient: 'from-purple-900/70',
    },
    5: {
        border: 'border-yellow-500',
        text: 'text-yellow-300',
        gradient: 'from-yellow-900/70',
    },
};

/** HP and AD scale by 1.8× per star level in standard TFT math */
const STAR_SCALING = 1.8;

/**
 * CDragon `%i:xxx%` icon markers indicate which champion stats an ability
 * scales with (displayed in-game as small icons). We render them as short
 * text labels alongside the numeric value.
 */
const SCALE_ICON_LABELS: Record<string, string> = {
    scaleAD: 'AD',
    scaleAP: 'AP',
    scaleArmor: 'AR',
    scaleMR: 'MR',
    scaleHealth: 'HP',
    scaleMana: 'Mana',
    scaleAS: 'AS',
    scaleCritChance: 'Crit',
    scaleCritDamage: 'CritDmg',
};

/**
 * CDragon ability descriptions use HTML-like tags to indicate damage types,
 * scaling, and semantic styling. We map them to Tailwind classes for colored
 * rendering that matches TFT in-game tooltip conventions.
 *
 * Unknown tags are stripped (content preserved, no wrapper span) so new
 * CDragon tags don't break rendering.
 */
const TAG_CLASS_MAP: Record<string, string> = {
    physicalDamage: 'font-semibold text-orange-400',
    magicDamage: 'font-semibold text-sky-400',
    trueDamage: 'font-semibold text-white',
    scaleHealth: 'font-semibold text-emerald-400',
    TFTBonus: 'font-semibold text-amber-400',
    TFTKeyword: 'font-semibold text-amber-300',
    scaleAD: 'text-orange-400',
    scaleAP: 'text-sky-400',
    scaleArmor: 'text-zinc-400',
    scaleMR: 'text-violet-400',
    scaleLevel: 'text-cyan-400',
    spellPassive: 'italic text-muted-foreground',
    spellActive: 'italic text-foreground/80',
    rules: 'italic text-muted-foreground',
};

function scaleStat(base: number, starLevel: number): number {
    if (starLevel === 1) return base;
    if (starLevel === 2) return base * STAR_SCALING;
    if (starLevel === 3) return base * STAR_SCALING * STAR_SCALING;
    return base;
}

/**
 * Detect CDragon's star-position offset convention for a champion.
 *
 * CDragon is INCONSISTENT about which array position represents 1-star:
 *   - Legacy en_us.json format: position 0 is a zero placeholder, real
 *     values start at position 1. [0, 100, 200, 300, 0, 0, 0] → offset=1
 *   - New BIN format, sentinel variant (MF, Jinx): position 0 is a
 *     non-zero SENTINEL value that repeats at the trailing unused
 *     positions. [2.5, 65, 100, 155, 265, 2.5, 2.5] → offset=1
 *   - New BIN format, misc placeholder (Caitlyn): position 0 is a
 *     non-zero value that does NOT repeat at trailing slots, but the
 *     real star values still start at position 1. [145, 170, 255, 510,
 *     875, 455, 455] → offset=1
 *
 * Voting heuristics, in order — first match wins:
 *   1. Sentinel: slot 0 == slot last AND != slot 1 → vote offset=1
 *   2. Zero pattern: slot 0 == 0 (legacy empty marker) → vote offset=1
 *   3. Monotonic rise across slots 1..3: star scaling lives there even
 *      when slot 0 is an unrelated non-sentinel placeholder (Caitlyn)
 *      → vote offset=1
 *   4. Otherwise slot 0 carries the 1-star value → vote offset=0
 *
 * Constant stats are excluded from the vote — their position 0 is
 * always meaningful.
 */
function detectStatOffset(stats: AbilityStat[]): number {
    let offsetOneVotes = 0;
    let offsetZeroVotes = 0;

    for (const stat of stats) {
        const values = stat.value;
        const last = values.length - 1;
        if (last < 1) continue;

        // Skip constant stats — all positions identical, offset doesn't matter
        const allSame = values.every((v) => v === values[0]);
        if (allSame) continue;

        const slot0 = values[0];
        const slot1 = values[1];
        const slot2 = values[2] ?? slot1;
        const slot3 = values[3] ?? slot2;
        const slotLast = values[last];

        // New BIN sentinel pattern: slot 0 repeats at trailing slot(s) and
        // slot 1 is different. This is how MF Set 17 stance spells encode
        // "no active star level" in unused array positions.
        const hasSentinelPattern = slot0 === slotLast && slot0 !== slot1;

        // Monotonic-rise pattern: slots 1..3 form a strictly increasing
        // star progression (TFT damage stats are always a growing curve).
        // This catches champions like Caitlyn whose slot 0 is a
        // non-sentinel placeholder value (145) that doesn't match trailing
        // slots — the star scaling still lives at 1..3.
        const hasRisingStarProgression =
            slot1 > 0 && slot2 > slot1 && slot3 > slot2;

        if (hasSentinelPattern || slot0 === 0 || hasRisingStarProgression) {
            offsetOneVotes++;
        } else {
            offsetZeroVotes++;
        }
    }

    return offsetOneVotes > offsetZeroVotes ? 1 : 0;
}

function getStarValue(
    stat: AbilityStat,
    starLevel: number,
    offset: number,
): number | undefined {
    // For constant stats, any position returns the same value, so offset is a no-op
    const allSame = stat.value.every((v) => v === stat.value[0]);
    if (allSame) return stat.value[0];

    return stat.value[offset + starLevel - 1];
}

/**
 * Resolve a CDragon placeholder variable name to the best-matching stat in
 * the champion's ability variables.
 *
 * Strategy:
 *   1. Exact name match (case insensitive), including stripped "Modified" prefix
 *   2. Prefix match — stat names starting with the stripped keyword
 *      (e.g., @ModifiedDamage@ → "damage" → matches "DamageAD", "DamagePercentArmor")
 *      - Prefer variants WITHOUT "Percent" in name (main value > scaling coefficient)
 *      - Among ties, prefer the stat with the highest non-zero value (primary damage)
 *   3. Substring match as a last resort
 *
 * Returns null if no reasonable match found — caller renders a "[Name]" stub.
 */
function resolvePlaceholderStat(
    varName: string,
    stats: AbilityStat[],
): AbilityStat | null {
    const exactCandidates = [
        varName.toLowerCase(),
        varName.replace(/^Modified/, '').toLowerCase(),
    ].filter(Boolean);

    // Phase 1: exact name match
    for (const candidate of exactCandidates) {
        const hit = stats.find((s) => s.name.toLowerCase() === candidate);
        if (hit) return hit;
    }

    const stripped = varName.replace(/^Modified/, '').toLowerCase();
    if (!stripped) return null;

    // Phase 2: prefix matches
    const prefixMatches = stats.filter((s) =>
        s.name.toLowerCase().startsWith(stripped),
    );

    const pickBest = (pool: AbilityStat[]): AbilityStat | null => {
        if (pool.length === 0) return null;
        // Prefer names without "Percent" (those are usually scaling coefficients)
        const nonPercent = pool.filter((s) => !/percent/i.test(s.name));
        const candidatePool = nonPercent.length > 0 ? nonPercent : pool;
        // Tiebreak by max non-zero value in the array (primary = larger magnitude)
        return candidatePool
            .slice()
            .sort((a, b) => {
                const maxA = Math.max(
                    ...a.value.filter((v) => v !== 0).map(Math.abs),
                    0,
                );
                const maxB = Math.max(
                    ...b.value.filter((v) => v !== 0).map(Math.abs),
                    0,
                );
                return maxB - maxA;
            })[0];
    };

    const prefixPick = pickBest(prefixMatches);
    if (prefixPick) return prefixPick;

    // Phase 3: substring match anywhere in stat name
    const substrMatches = stats.filter((s) =>
        s.name.toLowerCase().includes(stripped),
    );
    const substrPick = pickBest(substrMatches);
    if (substrPick) return substrPick;

    // Phase 4: Scaling-variable fallback for @Modified*@ placeholders.
    // When @ModifiedDamage@ has no Damage-named variable, the damage is
    // usually computed from a scaling coefficient (e.g., ARMARScaling for
    // damage that scales with armor+MR — see Galio base). The surrounding
    // description context with `%i:scaleArmor%%i:scaleMR%` icon markers
    // already tells the user WHICH stats the scaling applies to; we just
    // need to surface the coefficient value itself.
    if (/^Modified/i.test(varName)) {
        const scalingStats = stats.filter((s) => /Scaling$/i.test(s.name));
        const scalingPick = pickBest(scalingStats);
        if (scalingPick) return scalingPick;
    }

    return null;
}

/**
 * Auto-color based on variable name when a placeholder isn't already wrapped
 * in a CDragon color tag. Palette roughly mirrors TFT in-game tooltip
 * conventions, with distinct colors per semantic category.
 *
 * Always returns a class — unrecognized variables fall through to a neutral
 * highlight so every numeric value stands out from surrounding prose.
 */
function autoColorForStat(stat: AbilityStat): string {
    const name = stat.name.toLowerCase();

    // Healing — green (TFT standard)
    if (/heal/.test(name)) return 'font-semibold text-emerald-400';

    // Shields — cyan (defensive, TFT uses blue-ish for shield bars)
    if (/shield/.test(name)) return 'font-semibold text-cyan-400';

    // Damage — orange (physical damage TFT convention)
    if (/damage|shockwave|burst|nova/.test(name)) {
        return 'font-semibold text-orange-400';
    }

    // Negative / debuff effects — rose (HPPenalty, DamageReduction, Slow)
    if (/penalty|reduction|debuff|slow|stun|silence/.test(name)) {
        return 'font-semibold text-rose-400';
    }

    // Mana-related — blue (TFT mana bar color)
    if (/mana|cost/.test(name)) return 'font-semibold text-blue-400';

    // Stat bonuses / defensive buffs — amber
    if (/durability|bonus|resist|tenacity|armor|attackspeed|critchance/.test(name)) {
        return 'font-semibold text-amber-400';
    }

    // Neutral fallback — subtle amber tint, still clearly bolded
    return 'font-semibold text-amber-200';
}

/**
 * Parse CDragon ability description into React JSX with per-star-level value
 * substitution and color-coded damage/heal types.
 *
 * CDragon descriptions embed placeholders like `@ModifiedHeal@` that map to
 * entries in ability_stats. We resolve them (see resolvePlaceholderStat)
 * and render the surrounding HTML-like tags (`<physicalDamage>`, `<scaleHealth>`,
 * etc.) as colored `<span>` elements matching TFT's in-game tooltip styling.
 *
 * If a placeholder is NOT inside a known color tag, its value is auto-colored
 * based on the stat name (damage → orange, heal → green, etc.) via
 * autoColorForStat. Nested tags are handled via recursive tokenization.
 */
function parseAbilityDescription(
    desc: string | null,
    stats: AbilityStat[],
    starLevel: number,
    statOffset: number,
): React.ReactNode | null {
    if (!desc) return null;

    let text = desc;

    // Strip conditional <ShowIf.X>...</ShowIf.X> blocks — game-state dependent
    // markup (e.g., capstone augment active) we can't evaluate statically.
    text = text.replace(/<ShowIf\.[^>]+>[\s\S]*?<\/ShowIf\.[^>]+>/g, '');

    // Convert <br> to newlines before other tag stripping
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Fix malformed scale icon markers in Riot's templates. Some stringtable
    // entries (observed: MF Set 17 Challenger Mode) close the final marker
    // early, producing `(%i:scaleAD%%i:scaleAP)` — the second `%i:scaleAP`
    // has no trailing `%`. Insert the missing `%` so the consecutive-marker
    // regex below can match the full sequence and join with "+".
    //
    // Heuristic: `%i:word` not followed by `%` needs its closer. The
    // lookahead also rejects word chars to prevent the greedy `\w+`
    // from backtracking into the middle of a correctly-closed marker
    // (e.g. `%i:scaleAD%` would otherwise match `%i:scaleA` + `D`).
    text = text.replace(/(%i:\w+)(?![%\w])/g, '$1%');

    // Convert scaling icon markers like %i:scaleAD% into short text labels.
    // In-game these render as small icons indicating which champion stats
    // the damage/heal scales with. We replace them with abbreviated labels
    // and join consecutive markers with "+" since they typically add up
    // (e.g., ARMARScaling applies to both armor and MR simultaneously).
    text = text.replace(/(?:%i:\w+%)+/g, (match) => {
        const parts = match.match(/%i:(\w+)%/g) || [];
        const labels = parts.map((p) => {
            const name = p.replace(/%i:|%/g, '');
            return SCALE_ICON_LABELS[name] ?? name.replace(/^scale/, '');
        });
        return labels.join('+');
    });

    // Strip &nbsp; and other HTML entities
    text = text.replace(/&nbsp;/g, ' ');

    // Collapse multiple consecutive newlines and whitespace
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.trim();

    if (!text) return null;

    // Tokenize tags AND placeholders together, carrying the "am I inside a
    // color tag" context so we can decide between inherited tag colors
    // and auto-color fallback for standalone placeholders.
    return renderAbilityTokens(text, {
        stats,
        starLevel,
        statOffset,
        insideColorTag: false,
    });
}

type RenderContext = {
    stats: AbilityStat[];
    starLevel: number;
    statOffset: number;
    /** True when recursing into a tag that already applies a color class */
    insideColorTag: boolean;
};

/**
 * Recursively tokenize CDragon's HTML-like markup AND `@Placeholder@`
 * references into React nodes.
 *
 * One combined regex matches either `<tag>content</tag>` blocks or
 * `@VarName@` / `@VarName*N@` placeholders. For tags, content is recursed
 * with `insideColorTag` flipped when a known color tag is encountered.
 * For placeholders, the value is wrapped in an auto-colored span only when
 * not inside a parent color tag — otherwise we emit a plain text node so
 * the outer tag's color wins without nested CSS inheritance confusion.
 */
function renderAbilityTokens(
    text: string,
    ctx: RenderContext,
): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    // Combined regex: tag OR placeholder. Alternation means one of the
    // capture groups will be set per match.
    const tokenRegex =
        /<(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|@([A-Za-z][A-Za-z0-9_]*)(?:\*(\d+(?:\.\d+)?))?@/g;
    const matches = Array.from(text.matchAll(tokenRegex));
    let lastIndex = 0;
    let key = 0;

    for (const match of matches) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) {
            nodes.push(text.slice(lastIndex, match.index));
        }

        if (match[1] !== undefined) {
            // Tag branch: <tag>content</tag>
            const tagName = match[1];
            const innerText = match[2];
            const className = TAG_CLASS_MAP[tagName];

            const childCtx: RenderContext = {
                ...ctx,
                insideColorTag: className ? true : ctx.insideColorTag,
            };
            const innerNodes = renderAbilityTokens(innerText, childCtx);

            if (className) {
                nodes.push(
                    <span key={`tag-${key++}`} className={className}>
                        {innerNodes}
                    </span>,
                );
            } else {
                // Unknown tag — unwrap, inline content directly
                nodes.push(...innerNodes);
            }
        } else if (match[3] !== undefined) {
            // Placeholder branch: @VarName@ or @VarName*N@
            const varName = match[3];
            const multiplierStr = match[4];

            const stat = resolvePlaceholderStat(varName, ctx.stats);
            if (!stat) {
                nodes.push(`[${varName.replace(/^Modified/, '')}]`);
            } else {
                const rawValue = getStarValue(
                    stat,
                    ctx.starLevel,
                    ctx.statOffset,
                );
                if (rawValue === undefined) {
                    nodes.push(`[${stat.name}]`);
                } else {
                    const valueStr = multiplierStr
                        ? formatStatValue(
                              rawValue * parseFloat(multiplierStr),
                              { explicitMultiplier: true },
                          )
                        : formatStatValue(rawValue, {
                              stat,
                              suppressUnitSuffix: true,
                          });

                    // Auto-color only when not already inside a color tag
                    // (parent tag's color wins otherwise — no nested styling)
                    if (ctx.insideColorTag) {
                        nodes.push(valueStr);
                    } else {
                        nodes.push(
                            <span
                                key={`ph-${key++}`}
                                className={autoColorForStat(stat)}
                            >
                                {valueStr}
                            </span>,
                        );
                    }
                }
            }
        }

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
    }

    return nodes.length > 0 ? nodes : [text];
}

type FormatOpts = {
    /** The whole stat (enables variable-name-based percent detection) */
    stat?: AbilityStat;
    /** Description used explicit *N multiplier — don't apply auto-percent */
    explicitMultiplier?: boolean;
    /**
     * Skip unit suffixes like "s" (seconds) and "hex" when rendering inside
     * an ability description — the description author already writes literal
     * " seconds" or "-hex range" surrounding the placeholder, and we don't
     * want "in a 2 hex-hex range" type duplications.
     */
    suppressUnitSuffix?: boolean;
};

/**
 * Detect whether a stat represents a ratio that needs ×100 scaling for
 * percentage display. The only reliable signal turns out to be the actual
 * numeric range of the values — suffix-based detection caused bugs like
 * `ProcChance = [15, 15, 15]` being scaled to 1500% because the name ends
 * in "Chance" even though the values are already in flat percent form.
 *
 * Rule: if every non-zero value is strictly below 1, treat as a ratio
 * (e.g. DamageFalloff = [0.3, 0.3, ...] → "30%"). Otherwise the data is
 * already in display units (ProcChance, AttackSpeedPercent, most
 * TFT-era stats) and the suffix meaning is preserved by the template's
 * literal "%" character.
 */
function isPercentStat(stat: AbilityStat): boolean {
    // Duration variables are handled separately by isDurationStat — never %
    if (isDurationStat(stat)) return false;

    const nonZeroValues = stat.value.filter((v) => v !== 0);
    if (nonZeroValues.length === 0) return false;

    return nonZeroValues.every((v) => Math.abs(v) < 1);
}

/**
 * Detect time/seconds variables by name suffix. Examples:
 *   DurabilityDuration, ShieldDuration, BuffDebuffDuration, ShotgunCooldown,
 *   NumSeconds, RefreshSeconds
 */
function isDurationStat(stat: AbilityStat): boolean {
    return /(?:Duration|Seconds|Cooldown)$/i.test(stat.name);
}

/**
 * Detect hex-range variables — ability area-of-effect radius in board hexes.
 * Examples: HexRange, SearchRange (when it's hex-based), AoeHexRange
 */
function isHexStat(stat: AbilityStat): boolean {
    return /Hex(?:Range)?$/i.test(stat.name);
}

function formatStatValue(val: number, opts: FormatOpts = {}): string {
    const { stat, explicitMultiplier, suppressUnitSuffix } = opts;

    // Description already did the math via `@Var*N@` — render the result
    // as-is, the description has literal "%" or context surrounding it.
    if (explicitMultiplier) {
        if (Number.isInteger(val)) return String(val);
        return val.toFixed(1);
    }

    // Variable-name-based formatting (used by raw values table and parser)
    if (stat) {
        // Duration and Hex stats only get their unit suffixes in the raw
        // values table — in the ability description the surrounding prose
        // already says "seconds" or "-hex range", so we return bare numbers.
        if (isDurationStat(stat)) {
            const formatted = Number.isInteger(val) ? String(val) : val.toFixed(1);
            return suppressUnitSuffix ? formatted : formatted + 's';
        }
        if (isHexStat(stat)) {
            const rounded = String(Math.round(val));
            return suppressUnitSuffix ? rounded : rounded + ' hex';
        }
        if (isPercentStat(stat)) {
            // Surrounding description prose carries the literal "%"
            // character, so in-parser calls that pass suppressUnitSuffix
            // should get the bare scaled number to avoid double "%%"
            // output. Raw-values-table callers leave the unit in.
            const scaled = Math.round(val * 100);

            return suppressUnitSuffix ? String(scaled) : `${scaled}%`;
        }
    }

    // Default formatting rules (used when no stat context)
    if (Number.isInteger(val)) return String(val);
    if (Math.abs(val) < 1) return Math.round(val * 100) + '%';
    return val.toFixed(1);
}

export default function ChampionShow({ champion, variants, rating }: Props) {
    const [starLevel, setStarLevel] = useState(2);

    const style = COST_STYLES[Math.min(Math.max(champion.cost, 1), 5)];

    // Traits grouped for display — public on top, unique below, hidden never shown
    const displayTraits = champion.traits.filter((t) => t.category !== 'hidden');

    // Scale HP and AD for the selected star level
    const scaledStats = useMemo(
        () => ({
            hp: Math.round(scaleStat(champion.stats.hp, starLevel)),
            attack_damage: Math.round(
                scaleStat(champion.stats.attack_damage, starLevel),
            ),
        }),
        [champion.stats, starLevel],
    );

    // Per-champion offset for mapping star levels to array positions.
    // Different CDragon conventions per champion — see detectStatOffset docs.
    const statOffset = useMemo(
        () => detectStatOffset(champion.ability_stats),
        [champion.ability_stats],
    );

    // Parsed ability description for current star level
    const parsedAbility = useMemo(
        () =>
            parseAbilityDescription(
                champion.ability_desc,
                champion.ability_stats,
                starLevel,
                statOffset,
            ),
        [champion.ability_desc, champion.ability_stats, starLevel, statOffset],
    );

    // TFT only has 1-3★ in normal play. CDragon arrays often contain 5-7
    // positions with debug/chibi/placeholder data at positions 3-6 that
    // looks "real" (non-zero) but isn't actual in-game values. Keep display
    // strictly to 1-3★ to avoid misleading the user.
    const visibleStarLevels = [1, 2, 3];

    return (
        <>
            <Head title={`${champion.name} — TFT Scout`} />

            <div className="flex flex-col gap-6 p-6">
                {/* Back link */}
                <Link
                    href="/champions"
                    className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft className="size-4" />
                    Back to Champions
                </Link>

                {/* ── Hero section ──────────────────────── */}
                <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
                    {/* Splash + star selector */}
                    <div className="flex flex-col gap-3">
                        <div
                            className={cn(
                                'relative aspect-square w-full overflow-hidden rounded-lg border-2 lg:w-80',
                                style.border,
                            )}
                        >
                            <div
                                className={cn(
                                    'absolute inset-0 z-10 bg-gradient-to-t to-transparent',
                                    style.gradient,
                                )}
                            />
                            <img
                                src={`/icons/champions/${champion.api_name}.png`}
                                alt={champion.name}
                                className="size-full object-cover"
                                onError={(e) => {
                                    (
                                        e.target as HTMLImageElement
                                    ).style.display = 'none';
                                }}
                            />
                        </div>

                        {/* Star level selector */}
                        <StarSelector
                            current={starLevel}
                            onSelect={setStarLevel}
                        />
                    </div>

                    {/* Info column */}
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-3">
                                    <h1 className="text-3xl font-bold tracking-tight">
                                        {champion.name}
                                    </h1>
                                    <Badge
                                        className={cn(
                                            'font-mono text-xs',
                                            style.text,
                                        )}
                                        variant="outline"
                                    >
                                        {champion.cost} cost
                                    </Badge>
                                </div>
                                {champion.role && (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {champion.damage_type} ·{' '}
                                        {champion.role_category}
                                    </p>
                                )}
                                {!champion.is_playable && (
                                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                        <Info className="size-3" />
                                        Not directly playable — pick a form
                                        below
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Traits */}
                        {displayTraits.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">
                                    Traits
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {displayTraits.map((trait) => (
                                        <div
                                            key={trait.api_name}
                                            className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1"
                                        >
                                            <img
                                                src={`/icons/traits/${trait.api_name}.png`}
                                                alt={trait.name}
                                                className="size-5"
                                                onError={(e) => {
                                                    (
                                                        e.target as HTMLImageElement
                                                    ).style.display = 'none';
                                                }}
                                            />
                                            <span className="text-sm">
                                                {trait.name}
                                            </span>
                                            {trait.category === 'unique' && (
                                                <Badge
                                                    variant="outline"
                                                    className="ml-1 px-1 py-0 text-[9px]"
                                                >
                                                    unique
                                                </Badge>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Variant selector */}
                        {variants.length > 0 && (
                            <VariantList
                                variants={variants}
                                currentApiName={champion.api_name}
                            />
                        )}
                    </div>
                </div>

                {/* ── Stats ──────────────────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            Stats at{' '}
                            <span className="text-amber-500">
                                {'★'.repeat(starLevel)}
                            </span>{' '}
                            level
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                        <StatCell
                            label="HP"
                            value={scaledStats.hp}
                            highlighted={starLevel > 1}
                        />
                        <StatCell
                            label="Attack Damage"
                            value={scaledStats.attack_damage}
                            highlighted={starLevel > 1}
                        />
                        <StatCell
                            label="Attack Speed"
                            value={champion.stats.attack_speed.toFixed(2)}
                        />
                        <StatCell label="Armor" value={champion.stats.armor} />
                        <StatCell
                            label="Magic Resist"
                            value={champion.stats.magic_resist}
                        />
                        <StatCell
                            label="Range"
                            value={champion.stats.range}
                        />
                        <StatCell
                            label="Mana"
                            value={`${champion.stats.start_mana} / ${champion.stats.mana}`}
                        />
                        <StatCell
                            label="Crit Chance"
                            value={`${Math.round(champion.stats.crit_chance * 100)}%`}
                        />
                        <StatCell
                            label="Crit Multiplier"
                            value={`${champion.stats.crit_multiplier.toFixed(1)}×`}
                        />
                    </CardContent>
                </Card>

                {/* ── Ability ─────────────────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            Ability (values shown for{' '}
                            <span className="text-amber-500">
                                {'★'.repeat(starLevel)}
                            </span>
                            )
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {parsedAbility ? (
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                                {parsedAbility}
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No ability description available.
                            </p>
                        )}

                        {/* Raw ability stats table for debugging / power users */}
                        {champion.ability_stats.length > 0 && (
                            <details className="mt-4">
                                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                    Raw ability values per star level
                                </summary>
                                <div className="mt-2 overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b text-left text-muted-foreground">
                                                <th className="py-1 pr-4">
                                                    Variable
                                                </th>
                                                {visibleStarLevels.map((s) => (
                                                    <th
                                                        key={s}
                                                        className={cn(
                                                            'py-1 pr-4 text-right',
                                                            s === starLevel &&
                                                                'text-amber-500',
                                                        )}
                                                    >
                                                        ★{s}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {champion.ability_stats.map(
                                                (stat) => (
                                                    <tr
                                                        key={stat.name}
                                                        className={cn(
                                                            'border-b border-border/40',
                                                            stat.kind === 'calculated' &&
                                                                'bg-amber-500/5',
                                                        )}
                                                    >
                                                        <td className="py-1 pr-4 font-mono">
                                                            {stat.name}
                                                            {stat.kind === 'calculated' && (
                                                                <span
                                                                    className="ml-1 text-[9px] text-amber-500/70"
                                                                    title="Computed from raw data values via spell formula"
                                                                >
                                                                    fx
                                                                </span>
                                                            )}
                                                        </td>
                                                        {visibleStarLevels.map(
                                                            (s) => {
                                                                const value =
                                                                    getStarValue(
                                                                        stat,
                                                                        s,
                                                                        statOffset,
                                                                    );
                                                                return (
                                                                    <td
                                                                        key={s}
                                                                        className={cn(
                                                                            'py-1 pr-4 text-right font-mono',
                                                                            s ===
                                                                                starLevel &&
                                                                                'text-amber-500',
                                                                        )}
                                                                    >
                                                                        {value !==
                                                                        undefined
                                                                            ? formatStatValue(
                                                                                  value,
                                                                                  {
                                                                                      stat,
                                                                                  },
                                                                              )
                                                                            : '—'}
                                                                    </td>
                                                                );
                                                            },
                                                        )}
                                                    </tr>
                                                ),
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </details>
                        )}
                    </CardContent>
                </Card>

                {/* ── MetaTFT Performance (placeholder) ───── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            MetaTFT Performance
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {rating ? (
                            // When rating is populated from Phase B:
                            // Display score, tier, win rate, avg place, games, trend arrow
                            <p>Rating display TBD</p>
                        ) : (
                            <div className="flex flex-col gap-3 text-sm">
                                <div className="inline-flex w-fit items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
                                    <Info className="size-3" />
                                    MetaTFT integration coming soon
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-muted-foreground sm:grid-cols-4">
                                    <StatCell label="Score" value="—" />
                                    <StatCell label="Tier" value="—" />
                                    <StatCell label="Avg Place" value="—" />
                                    <StatCell label="Games" value="—" />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Win rates, tier placement and trend
                                    indicators will appear here once live
                                    MetaTFT data is integrated.
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </>
    );
}

// ── Sub-components ──────────────────────────────────────

function StarSelector({
    current,
    onSelect,
}: {
    current: number;
    onSelect: (star: number) => void;
}) {
    return (
        <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/30 p-2">
            {[1, 2, 3].map((star) => (
                <Tooltip key={star}>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onClick={() => onSelect(star)}
                            className={cn(
                                'flex size-10 items-center justify-center rounded transition-all',
                                current === star
                                    ? 'bg-amber-500/20 text-amber-500 ring-2 ring-amber-500'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                        >
                            <Star
                                className="size-5"
                                fill={
                                    current >= star ? 'currentColor' : 'none'
                                }
                                strokeWidth={current >= star ? 0 : 2}
                            />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>
                        Show values at {'★'.repeat(star)} level
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
}

function StatCell({
    label,
    value,
    highlighted = false,
}: {
    label: string;
    value: string | number;
    highlighted?: boolean;
}) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
            </span>
            <span
                className={cn(
                    'font-mono text-base',
                    highlighted && 'text-amber-500',
                )}
            >
                {value}
            </span>
        </div>
    );
}

function VariantList({
    variants,
    currentApiName,
}: {
    variants: Champion[];
    currentApiName: string;
}) {
    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
                Forms
            </p>
            <div className="flex flex-wrap gap-2">
                {variants.map((variant) => {
                    const isCurrent = variant.api_name === currentApiName;
                    // Base champions have variant_label=null → show "Base"
                    // Variants show their capitalized label ("Enhanced", "Conduit", ...)
                    const label = variant.variant_label
                        ? variant.variant_label.charAt(0).toUpperCase() +
                          variant.variant_label.slice(1)
                        : 'Base';
                    return (
                        <Button
                            key={variant.api_name}
                            asChild
                            variant={isCurrent ? 'default' : 'outline'}
                            size="sm"
                        >
                            <Link
                                href={`/champions/${variant.api_name}`}
                                prefetch
                            >
                                {label}
                            </Link>
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}

ChampionShow.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[
            { title: 'Browse', href: '#' },
            { title: 'Champions', href: '/champions' },
        ]}
    >
        {page}
    </AppLayout>
);
