// @ts-nocheck
/* eslint-disable */
/**
 * Duplication scanner for the scout worker.
 *
 * Walks `resources/js/workers/scout/` for `.ts` files, tokenises each
 * one, hashes sliding 8-line windows after normalising identifiers to
 * `_`, and prints any hash collisions as potential duplicated blocks.
 *
 * Output is raw — manual review filters false positives before the
 * audit report is written. The scanner is strictly observational:
 * it never touches source files.
 *
 * Usage:
 *   npx tsx scripts/scout-audit/duplication.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const WINDOW = 8;
const ROOT = resolve(process.cwd(), 'resources/js/workers/scout');

function walk(dir: string): string[] {
    const out: string[] = [];

    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);

        if (st.isDirectory()) {
            out.push(...walk(full));
        } else if (name.endsWith('.ts')) {
            out.push(full);
        }
    }

    return out;
}

function normalise(line: string): string {
    return line
        .replace(/\/\/.*$/, '')
        .replace(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
}

function hashWindow(lines: string[]): string {
    return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 12);
}

type Hit = { file: string; startLine: number; preview: string };

const buckets = new Map<string, Hit[]>();

for (const file of walk(ROOT)) {
    const raw = readFileSync(file, 'utf8').split('\n');
    const normalised = raw.map(normalise);

    for (let i = 0; i + WINDOW <= normalised.length; i++) {
        const window = normalised.slice(i, i + WINDOW);

        if (window.filter(l => l.length > 0).length < WINDOW / 2) {
            continue;
        }

        const h = hashWindow(window);
        const hit: Hit = {
            file: file.replace(process.cwd() + '/', '').replace(process.cwd() + '\\', ''),
            startLine: i + 1,
            preview: raw[i].trim().slice(0, 80),
        };

        if (!buckets.has(h)) {
            buckets.set(h, []);
        }

        buckets.get(h)!.push(hit);
    }
}

const collisions = [...buckets.values()].filter(hits => hits.length > 1);

console.log(`# Duplication scan — ${collisions.length} collision buckets\n`);

for (const hits of collisions) {
    console.log('## collision');

    for (const h of hits) {
        console.log(`- ${h.file}:${h.startLine}  \`${h.preview}\``);
    }

    console.log('');
}
