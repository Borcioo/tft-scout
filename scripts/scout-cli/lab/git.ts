import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cached: string | null = null;

/**
 * Returns the current HEAD SHA by reading `.git/HEAD` directly.
 *
 * Handles:
 *   - detached HEAD                 → HEAD file contains a raw SHA
 *   - symbolic ref → loose ref file → `.git/refs/heads/<branch>`
 *   - symbolic ref → packed ref     → line inside `.git/packed-refs`
 *
 * Returns the literal string `'unknown'` if the checkout is not a git
 * repository or any read fails. Cached per process after the first call.
 */
export function currentGitSha(): string {
    if (cached !== null) {
return cached;
}

    try {
        const gitDir = resolve(process.cwd(), '.git');
        const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();

        if (!head.startsWith('ref: ')) {
            // Detached HEAD: the file IS the SHA.
            cached = head;

            return cached;
        }

        const refPath = head.slice(5).trim();

        try {
            cached = readFileSync(resolve(gitDir, refPath), 'utf8').trim();
        } catch {
            // Loose ref absent → check packed-refs.
            const packed = readFileSync(resolve(gitDir, 'packed-refs'), 'utf8');
            const line = packed
                .split('\n')
                .find((l) => l.endsWith(' ' + refPath));
            cached = line ? line.split(' ')[0] : 'unknown';
        }
    } catch {
        cached = 'unknown';
    }

    return cached;
}
