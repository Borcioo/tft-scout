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
        default:
            throw new Error(`Unknown lab subcommand: ${sub}`);
    }
}
