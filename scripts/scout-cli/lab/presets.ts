export type Preset = {
    description: string;
    matrix: Record<string, (string | number | null)[]>;
};

export const PRESETS: Record<string, Preset> = {
    'role-filter-sweep': {
        description:
            'Grid all minFrontline x minDps combos 0..6 at level 8, three seeds.',
        matrix: {
            level: [8],
            minFrontline: [0, 1, 2, 3, 4, 5, 6],
            minDps: [0, 1, 2, 3, 4, 5, 6],
            seed: [1, 2, 3],
        },
    },
    'level-sweep': {
        description:
            'How top-N composition changes across levels 6..10, five seeds.',
        matrix: {
            level: [6, 7, 8, 9, 10],
            seed: [1, 2, 3, 4, 5],
        },
    },
};
