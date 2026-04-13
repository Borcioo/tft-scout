// Public types exposed across the worker boundary. The algorithm
// internals use plain JS objects (ported 1:1 from legacy) and stay
// loosely typed — only these top-level shapes are declared.

export type Champion = {
    apiName: string;
    name: string;
    cost: number;
    traits: string[];        // trait api_names
    traitNames: string[];    // human-readable names (for UI rendering)
    slotsUsed: number;       // 2 for Mecha Enhanced
    baseApiName: string | null;
    variant: string | null;  // 'hero' | 'conduit' | 'challenger' | ...
    role: string | null;
    damageType: string | null;
    roleCategory: string | null;
    icon: string;
    abilityIcon: string | null;
    plannerCode: number | null;
};

export type TraitBreakpoint = {
    position: number;
    minUnits: number;
    maxUnits: number | null;
    style: 'Bronze' | 'Silver' | 'Gold' | 'Prismatic' | 'Unique' | null;
};

export type Trait = {
    apiName: string;
    name: string;
    category: 'public' | 'unique';
    breakpoints: TraitBreakpoint[];
    icon: string;
};

export type UnitRating = {
    avgPlace: number;
    winRate: number;
    top4Rate: number;
    games: number;
    score: number;
};

export type TraitRatingEntry = {
    avgPlace: number;
    winRate: number;
    games: number;
    score: number;
};

export type AffinityEntry = {
    trait: string;
    breakpoint: number;
    avgPlace: number;
    games: number;
    frequency: number;
};

export type CompanionEntry = {
    companion: string;
    avgPlace: number;
    games: number;
    frequency: number;
};

export type MetaCompEntry = {
    id: string;
    name: string;
    units: string[];
    avgPlace: number;
    games: number;
    level: number;
};

export type ScoringContext = {
    unitRatings: Record<string, UnitRating>;
    traitRatings: Record<string, Record<number, TraitRatingEntry>>;
    affinity: Record<string, AffinityEntry[]>;
    companions: Record<string, CompanionEntry[]>;
    metaComps: MetaCompEntry[];
    styleScores: Record<string, number>;
};

export type ScoutContext = {
    champions: Champion[];
    traits: Trait[];
    exclusionGroups: string[][];
    scoringCtx: ScoringContext;
    syncedAt: string | null;
    stale: boolean;
};

export type ScoutConstraints = {
    lockedChampions: string[];
    excludedChampions: string[];
    lockedTraits: { apiName: string; minUnits: number }[];
    excludedTraits: string[];
    emblems: { apiName: string; count: number }[];
    max5Cost: number | null;
    roleBalance: boolean | null;
};

export type ScoutParams = {
    lockedChampions?: string[];
    excludedChampions?: string[];
    lockedTraits?: { apiName: string; minUnits: number }[];
    excludedTraits?: string[];
    emblems?: { apiName: string; count: number }[];
    level?: number;
    topN?: number;
    max5Cost?: number | null;
    roleBalance?: boolean | null;
    seed?: number;
};

export type ScoredTeamChampion = {
    apiName: string;
    baseApiName: string | null;
    name: string;
    cost: number;
    role: string | null;
    traits: string[];
    traitNames: string[];
    variant: string | null;
    slotsUsed: number;
    icon: string;
    plannerCode: number | null;
};

export type ScoredActiveTrait = {
    apiName: string;
    name: string;
    icon: string | null;
    count: number;
    style: string | null;
    breakpoint: number | null;
};

export type ScoredTeam = {
    champions: ScoredTeamChampion[];
    activeTraits: ScoredActiveTrait[];
    score: number;
    breakdown: Record<string, number> | null;
    level: number;
    slotsUsed: number;
    roles: Record<string, number> | null;
    metaMatch: { id: string; name: string; similarity: number } | null;
    insights: TeamInsights | null;
};

export type WorkerInMsg =
    | { type: 'generate'; id: number; params: ScoutParams }
    | { type: 'roadTo'; id: number; params: unknown };

export type WorkerOutMsg =
    | { id: number; result: { results: ScoredTeam[]; insights: unknown } }
    | { id: number; error: string };

// ── "Why this comp?" insights ────────────────────
// Produced by the worker (see team-insights.ts) and rendered by
// WhyThisComp.tsx. Discriminated union lets the UI switch on `kind`
// without needing any string parsing.

export type InsightItem =
    | { kind: 'metaMatch'; compName: string; avgPlace: number; games: number }
    | { kind: 'topCarry'; championApiName: string; displayName: string; avgPlace: number; games: number }
    | { kind: 'strongTrait'; traitApiName: string; displayName: string; count: number; avgPlace: number; games: number }
    | { kind: 'affinityHit'; championApiName: string; championName: string; traitApiName: string; traitName: string; avgPlace: number }
    | { kind: 'provenPair'; aApi: string; aName: string; bApi: string; bName: string; avgPlace: number }
    | { kind: 'highBreakpoint'; traitApiName: string; displayName: string; count: number; avgPlace: number }
    | { kind: 'weakChampion'; championApiName: string; championName: string; avgPlace: number; reasonTraitName: string }
    | { kind: 'lowBreakpoint'; traitApiName: string; displayName: string; count: number; avgPlace: number }
    | { kind: 'unprovenTrait'; traitApiName: string; displayName: string; games: number }
    | { kind: 'singleCore'; traitApiName: string; displayName: string }
    | { kind: 'noMetaMatch' }
    | { kind: 'staleData' };

export type TeamInsights = {
    strengths: InsightItem[];
    concerns: InsightItem[];
};
