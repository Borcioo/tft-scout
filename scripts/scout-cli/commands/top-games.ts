/**
 * `scout-cli top-games` — full boards from the top of the ladder, from
 * Riot's API, frozen to disk.
 *
 * MetaTFT's finest skill filter is a rank tier (Challenger ≈ thousands of
 * players across regions). The best players find new comps before the
 * masses do, and only Riot's match data has their exact boards — units
 * with stars and items, level, traits, placement — for the whole lobby.
 *
 *   1. /tft/league/v1/challenger per platform → the top N by LP
 *   2. /tft/match/v1/matches/by-puuid/{puuid}/ids → their recent matches
 *   3. /tft/match/v1/matches/{id} → all 8 boards of each ranked match of
 *      the current set
 *
 * Stores boards only: no puuids or names, just whether the board belonged
 * to one of the top players. Resumable — the output file keeps fetched
 * match ids; a rerun only fetches what is missing.
 *
 * Needs RIOT_API_KEY (developer.riotgames.com; a development key lasts
 * 24 h). Limits handled for a development key: 20 requests/s and
 * 100/2 min per routing host, Retry-After on 429.
 *
 * Usage:
 *   RIOT_API_KEY=… npm run scout -- top-games [--set 18] [--top 200]
 *       [--platforms kr,euw1,na1,…] [--matches 20] [--days 3]
 *       [--out tmp/scout-eval/top-games-18.json]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RANKED_QUEUE = 1100;

/** Platform → regional routing for match-v1. */
const ROUTING: Record<string, string> = {
    br1: 'americas',
    la1: 'americas',
    la2: 'americas',
    na1: 'americas',
    eun1: 'europe',
    euw1: 'europe',
    tr1: 'europe',
    ru: 'europe',
    me1: 'europe',
    jp1: 'asia',
    kr: 'asia',
    oc1: 'sea',
    sg2: 'sea',
    tw2: 'sea',
    vn2: 'sea',
};

type Unit = { character: string; stars: number; items: string[] };

type Board = {
    match: string;
    /** One of the top-N players' own board (the rest are lobby mates). */
    top: boolean;
    placement: number;
    level: number;
    lastRound: number;
    goldLeft: number;
    units: Unit[];
    /** Active traits: api name → units counted. */
    traits: Record<string, number>;
};

type TopGamesFile = {
    set: number;
    fetchedAt: string;
    players: number;
    /** Match ids fetched (kept or skipped as another queue / set). */
    done: string[];
    boards: Board[];
};

function parseArgs(argv: string[]) {
    const args = {
        set: 18,
        top: 200,
        platforms: Object.keys(ROUTING),
        matches: 20,
        days: 3,
        out: '',
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];

        if (a === '--set') {
            args.set = Number(argv[++i]);
        } else if (a === '--top') {
            args.top = Number(argv[++i]);
        } else if (a === '--platforms') {
            args.platforms = argv[++i].split(',');
        } else if (a === '--matches') {
            args.matches = Number(argv[++i]);
        } else if (a === '--days') {
            args.days = Number(argv[++i]);
        } else if (a === '--out') {
            args.out = argv[++i];
        } else {
            throw new Error(`Unknown flag for top-games: ${a}`);
        }
    }

    for (const p of args.platforms) {
        if (!ROUTING[p]) {
            throw new Error(`Unknown platform ${p}`);
        }
    }

    args.out ||= `tmp/scout-eval/top-games-${args.set}.json`;

    return args;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-host request budget: development keys allow 20/s and 100/2 min for
 * each routing value (euw1, europe, …).
 */
class Limiter {
    private sent = new Map<string, number[]>();

    async wait(host: string) {
        for (;;) {
            const now = Date.now();
            const recent = (this.sent.get(host) ?? []).filter(
                (t) => now - t < 120_000,
            );
            this.sent.set(host, recent);
            const lastSecond = recent.filter((t) => now - t < 1000).length;

            if (recent.length < 100 && lastSecond < 20) {
                recent.push(now);

                return;
            }

            await sleep(
                recent.length >= 100 ? 120_000 - (now - recent[0]) + 50 : 100,
            );
        }
    }
}

const limiter = new Limiter();

const HEADERS = join(tmpdir(), 'scout-top-games-headers.txt');

/** curl rather than fetch: it honours the proxy settings everywhere. */
async function riot(host: string, path: string, key: string): Promise<any> {
    for (let attempt = 0; attempt < 5; attempt++) {
        await limiter.wait(host);

        const out = execFileSync(
            'curl',
            [
                '-sS',
                '--max-time',
                '30',
                '-H',
                `X-Riot-Token: ${key}`,
                '-D',
                HEADERS,
                '-w',
                '\n%{http_code}',
                `https://${host}.api.riotgames.com${path}`,
            ],
            { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
        );
        const cut = out.lastIndexOf('\n');
        const body = out.slice(0, cut);
        const status = Number(out.slice(cut + 1));
        // Through a proxy the dump starts with the CONNECT response; the
        // last block is Riot's
        const head =
            readFileSync(HEADERS, 'utf8')
                .split(/\r?\n\r?\n/)
                .filter(Boolean)
                .at(-1) ?? '';

        if (status === 200) {
            return JSON.parse(body);
        }

        if (status === 429 || status >= 500) {
            const retry = Number(/retry-after: (\d+)/i.exec(head)?.[1] ?? 2);
            await sleep(retry * 1000);
            continue;
        }

        if (status === 401 || status === 403) {
            throw new Error(
                `Riot API ${status} on ${path}: RIOT_API_KEY missing, expired (development keys last 24 h) or not allowed`,
            );
        }

        if (status === 404) {
            return null;
        }

        throw new Error(`Riot API ${status} on ${path}`);
    }

    throw new Error(`Riot API kept failing on ${path}`);
}

/** Top players by LP across platforms (puuid + platform). */
async function topPlayers(platforms: string[], top: number, key: string) {
    const entries: { puuid: string; platform: string; lp: number }[] = [];

    for (const platform of platforms) {
        const league = await riot(
            platform,
            '/tft/league/v1/challenger?queue=RANKED_TFT',
            key,
        );

        for (const e of league?.entries ?? []) {
            let puuid = e.puuid;

            // Older responses carry only summonerId
            if (!puuid && e.summonerId) {
                puuid = (
                    await riot(
                        platform,
                        `/tft/summoner/v1/summoners/${e.summonerId}`,
                        key,
                    )
                )?.puuid;
            }

            if (puuid) {
                entries.push({ puuid, platform, lp: e.leaguePoints ?? 0 });
            }
        }

        process.stderr.write(
            `  ${platform}: ${league?.entries?.length ?? 0} challengers\n`,
        );
    }

    return entries.sort((a, b) => b.lp - a.lp).slice(0, top);
}

export function boardsOf(match: any, topPuuids: Set<string>, set: number) {
    const info = match?.info;

    if (info?.queue_id !== RANKED_QUEUE || info?.tft_set_number !== set) {
        return [];
    }

    return (info.participants ?? []).map(
        (p): Board => ({
            match: match.metadata.match_id,
            top: topPuuids.has(p.puuid),
            placement: p.placement,
            level: p.level,
            lastRound: p.last_round,
            goldLeft: p.gold_left,
            units: (p.units ?? []).map((u) => ({
                character: u.character_id,
                stars: u.tier,
                items: u.itemNames ?? [],
            })),
            traits: Object.fromEntries(
                (p.traits ?? [])
                    .filter((t) => (t.tier_current ?? 0) > 0)
                    .map((t) => [t.name, t.num_units]),
            ),
        }),
    );
}

export async function runTopGames(argv: string[]): Promise<void> {
    const args = parseArgs(argv);
    const key = process.env.RIOT_API_KEY;

    if (!key) {
        throw new Error(
            'top-games needs RIOT_API_KEY (developer.riotgames.com) in the environment',
        );
    }

    const file: TopGamesFile = existsSync(args.out)
        ? JSON.parse(readFileSync(args.out, 'utf8'))
        : {
              set: args.set,
              fetchedAt: new Date().toISOString(),
              players: 0,
              done: [],
              boards: [],
          };

    if (file.set !== args.set) {
        throw new Error(`${args.out} holds set ${file.set}, not ${args.set}`);
    }

    process.stderr.write(
        `top-games: ladder of ${args.platforms.length} platforms\n`,
    );
    const players = await topPlayers(args.platforms, args.top, key);
    const topPuuids = new Set(players.map((p) => p.puuid));
    file.players = players.length;

    const since = Math.floor(Date.now() / 1000) - args.days * 86_400;
    const todo = new Map<string, string>(); // match id → routing host
    const done = new Set(file.done);

    for (const p of players) {
        const host = ROUTING[p.platform];
        const ids: string[] =
            (await riot(
                host,
                `/tft/match/v1/matches/by-puuid/${p.puuid}/ids?start=0&count=${args.matches}&startTime=${since}`,
                key,
            )) ?? [];

        for (const id of ids) {
            if (!done.has(id)) {
                todo.set(id, host);
            }
        }
    }

    process.stderr.write(
        `top-games: ${players.length} players, ${todo.size} matches to fetch (${done.size} done)\n`,
    );

    let i = 0;

    for (const [id, host] of todo) {
        const match = await riot(host, `/tft/match/v1/matches/${id}`, key);
        file.boards.push(...boardsOf(match, topPuuids, args.set));
        file.done.push(id);

        if (++i % 25 === 0 || i === todo.size) {
            writeFileSync(args.out, JSON.stringify(file));
            process.stderr.write(`  ${i}/${todo.size}\n`);
        }
    }

    writeFileSync(args.out, JSON.stringify(file));

    const matches = new Set(file.boards.map((b) => b.match)).size;
    process.stdout.write(
        `${args.out}: ${matches} ranked set-${args.set} matches, ${file.boards.length} boards (${file.boards.filter((b) => b.top).length} of the top ${file.players})\n`,
    );
}
