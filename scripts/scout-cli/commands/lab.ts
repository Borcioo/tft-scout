export async function runLab(argv: string[]): Promise<void> {
    const sub = argv[0];
    const rest = argv.slice(1);
    if (!sub) throw new Error('lab requires a subcommand: init|doctor|stats|query|prune|reset');

    switch (sub) {
        case 'init': {
            const { runLabInit } = await import('./lab/init');
            return runLabInit(rest);
        }
        case 'doctor': {
            const { runLabDoctor } = await import('./lab/doctor');
            return runLabDoctor(rest);
        }
        case 'stats': {
            const { runLabStats } = await import('./lab/stats');
            return runLabStats(rest);
        }
        case 'query': {
            const { runLabQuery } = await import('./lab/query');
            return runLabQuery(rest);
        }
        case 'prune': {
            const { runLabPrune } = await import('./lab/prune');
            return runLabPrune(rest);
        }
        case 'reset': {
            const { runLabReset } = await import('./lab/reset');
            return runLabReset(rest);
        }
        default:
            throw new Error(`Unknown lab subcommand: ${sub}`);
    }
}
