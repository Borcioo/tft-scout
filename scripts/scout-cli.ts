#!/usr/bin/env tsx
/**
 * scout-cli — debug entry into the scout algorithm.
 *
 * Usage: npm run scout -- <command> [flags]
 *
 * See docs/superpowers/specs/2026-04-14-scout-cli-debug-tool-design.md
 * for the full command and flag reference.
 */

const HELP = `scout-cli — debug entry into the scout algorithm

Commands:
  snapshot              Fetch /api/scout/context and write tmp/scout-context.json
  snapshot --inspect    Fetch but print meta to stdout instead of writing
  context               Print meta of the saved snapshot
  context --champion N  Print one champion record from the saved snapshot
  context --trait N     Print one trait record from the saved snapshot
  generate [flags]      Run engine.generate end-to-end
  phase <name> [flags]  Run a single phase (candidates|graph|find-teams|score|active-traits|role-balance|insights)

Common flags:
  --level N             Player level (default 8)
  --top-n N             Number of results (default 10)
  --max-5cost N         Cap on 5-cost units
  --min-frontline N     Min frontline filter (default 0)
  --min-dps N           Min dps filter (default 0)
  --locked A,B,C        Locked champions
  --excluded A,B,C      Excluded champions
  --locked-trait T:N    Locked trait with min units
  --emblem T:N          Emblem on trait
  --seed N              RNG seed
  --team A,B,C          Required by per-team phase commands
  --params file.json    Full ScoutParams JSON (file overrides individual flags)
  --raw-input file.json Per-phase escape hatch (skip auto-build)
  --full                Disable smart summary
  --live                Skip snapshot, fetch /api/scout/context fresh
  --snapshot path.json  Override snapshot path (default tmp/scout-context.json)
`;

async function main() {
    const argv = process.argv.slice(2);
    const command = argv[0];

    if (!command || command === '--help' || command === '-h') {
        process.stdout.write(HELP);
        return;
    }

    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    process.exit(1);
}

main().catch((err) => {
    process.stderr.write(`scout-cli: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
});
