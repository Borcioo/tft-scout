/**
 * The one way CLI tools talk to MetaTFT: cached on disk, throttled,
 * budgeted.
 *
 * MetaTFT's API is unofficial and shared with its own site — bursts of
 * requests, or asking the same thing over and over, get us banned. Every response is copied to tmp/metatft-cache and
 * served from there while fresh, so a rerun or another tool asking the
 * same thing costs nothing. Network requests are spaced (one per 2 s)
 * and counted against a per-run and a per-day budget; past the budget a
 * request throws MetaTftBudgetError, which the resumable tools catch to
 * save progress and stop.
 *
 * Freshness: full match JSON never changes (kept forever); patch-pinned
 * stats and explorer answers for 7 days (frozen data is what the
 * analyses want); ladders and profiles for a day.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = 'tmp/metatft-cache';
const SPACING_MS = 2000;
const DAY_MS = 86_400_000;

export const METATFT_BUDGET = {
    /** Network requests one run may make (a full `oracle` is ~650). */
    perRun: 1000,
    /**
     * Network requests all runs together may make per UTC day — a safety
     * cap; the spacing is what keeps the load gentle. METATFT_DAY_BUDGET
     * raises it for a run on purpose.
     */
    perDay: Number(process.env.METATFT_DAY_BUDGET ?? 3000),
};

export class MetaTftBudgetError extends Error {}

function ttlFor(url: string): number {
    if (/^https:\/\/matches\d*\.metatft\.com\//.test(url)) {
        return Number.POSITIVE_INFINITY;
    }

    if (/tft-leaderboard|\/public\/profile\//.test(url)) {
        return DAY_MS;
    }

    return 7 * DAY_MS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let sentThisRun = 0;
let lastSent = 0;

function dayCounterPath() {
    return join(
        CACHE_DIR,
        `requests-${new Date().toISOString().slice(0, 10)}.json`,
    );
}

function sentToday(): number {
    const path = dayCounterPath();

    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).n : 0;
}

/** Requests sent by this process so far (for summaries). */
export function metatftRequestsThisRun() {
    return sentThisRun;
}

/**
 * GET JSON from MetaTFT. Cache first; on a miss, one throttled request
 * within budget. Returns null on 404.
 */
export async function metatftGet(url: string): Promise<any> {
    mkdirSync(CACHE_DIR, { recursive: true });

    const file = join(
        CACHE_DIR,
        `${createHash('sha1').update(url).digest('hex')}.json`,
    );

    if (existsSync(file)) {
        const cached = JSON.parse(readFileSync(file, 'utf8'));

        if (Date.now() - cached.fetchedAt < ttlFor(url)) {
            return cached.body;
        }
    }

    const today = sentToday();

    if (
        sentThisRun >= METATFT_BUDGET.perRun ||
        today >= METATFT_BUDGET.perDay
    ) {
        throw new MetaTftBudgetError(
            `MetaTFT budget reached (${sentThisRun}/${METATFT_BUDGET.perRun} this run, ${today}/${METATFT_BUDGET.perDay} today) — rerun later; progress is saved`,
        );
    }

    await sleep(Math.max(0, lastSent + SPACING_MS - Date.now()));
    lastSent = Date.now();
    sentThisRun++;
    writeFileSync(dayCounterPath(), JSON.stringify({ n: today + 1 }));

    const out = execFileSync(
        'curl',
        ['-sS', '--max-time', '60', '-w', '\n%{http_code}', url],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const cut = out.lastIndexOf('\n');
    const status = Number(out.slice(cut + 1));

    if (status === 404) {
        return null;
    }

    if (status !== 200) {
        // 429 or anything odd: stop rather than retry into a ban
        throw new MetaTftBudgetError(
            `MetaTFT answered HTTP ${status} on ${url} — stopping; progress is saved`,
        );
    }

    const body = JSON.parse(out.slice(0, cut));
    writeFileSync(file, JSON.stringify({ url, fetchedAt: Date.now(), body }));

    return body;
}
