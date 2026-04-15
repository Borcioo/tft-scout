# Repo Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the legacy Node stack, shipped superpowers docs, and research audits, and drop dangling `legacy/...` path references in two code comments.

**Architecture:** Non-runtime cleanup. Pure file/directory deletion plus two in-file comment edits. Git history preserves everything removed. Verification confirms no runtime breakage and no dangling references.

**Tech Stack:** Bash (rm), git, npm (lint/types), PHP/artisan (smoke tests), ripgrep/grep for verification.

**Spec:** `docs/superpowers/specs/2026-04-15-repo-cleanup-design.md`

---

## Pre-flight

- [ ] **Step 1: Confirm clean starting state**

Run: `git status --short`
Expected: only untracked `CLAUDE.md` + the already-committed spec. No modified tracked files.

If anything else is dirty, stop and ask before proceeding.

- [ ] **Step 2: Capture baseline verification signals**

Run each and note exit code (keep terminal output for comparison at the end):

```bash
npm run lint:check
npm run types:check
```

Expected: both exit 0 (or same warnings as current baseline). If they already fail on main, record the failure so we can tell "pre-existing" from "introduced by cleanup".

---

## Task 1: Delete `legacy/`

**Files:**
- Delete: `legacy/` (entire tree, 259K, 37 files)

- [ ] **Step 1: Confirm no runtime imports**

Run:

```bash
grep -rn "from ['\"].*legacy" resources/ app/ 2>/dev/null
grep -rn "require.*legacy" resources/ app/ 2>/dev/null
grep -rn "'legacy/" app/ resources/ 2>/dev/null
```

Expected: zero import/require hits. Only comment hits (the two files we edit in Task 5) may remain.

If any `import`/`require` line references `legacy/`, STOP — the spec assumed none existed. Escalate to user.

- [ ] **Step 2: Delete the directory**

Run: `rm -rf legacy/`

- [ ] **Step 3: Verify deletion**

Run: `ls legacy/ 2>&1`
Expected: `ls: cannot access 'legacy/': No such file or directory`

- [ ] **Step 4: Commit**

```bash
git add -A legacy/
git status --short
```

Expected: many `D  legacy/...` entries, nothing else new.

```bash
git commit -m "$(cat <<'EOF'
chore: remove legacy Node stack

The Node tft-generator stack was ported to Laravel on 2026-04-12 and
the scout algorithm lives in resources/js/workers/scout/. The legacy
tree has no runtime imports, only a few comment references (handled
in a follow-up commit). Git history preserves the full tree.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Delete `docs/legacy/`

**Files:**
- Delete: `docs/legacy/` (20 files: 9 plans + 11 specs from the Node era)

- [ ] **Step 1: Delete the directory**

Run: `rm -rf docs/legacy/`

- [ ] **Step 2: Verify deletion**

Run: `ls docs/legacy/ 2>&1`
Expected: "No such file or directory".

- [ ] **Step 3: Commit**

```bash
git add -A docs/legacy/
git commit -m "$(cat <<'EOF'
docs: remove legacy Node stack plans and specs

Historical plans/specs for the pre-port Node stack. All shipped work
lives in git history; the files add noise to grep/navigation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Delete shipped superpowers specs

**Files:**
- Delete, from `docs/superpowers/specs/`:
  - `2026-04-13-scout-port-design.md`
  - `2026-04-14-phase-locked-trait-seeded-design.md`
  - `2026-04-14-scout-cli-debug-tool-design.md`
  - `2026-04-14-scout-lab-sidecar-design.md`
  - `2026-04-14-scout-perf-sprint-design.md`
  - `2026-04-14-scout-role-filters-and-display-design.md`
  - `2026-04-14-scout-why-this-comp-design.md`
  - `2026-04-15-scout-refactor-cleanup-design.md`
- **Keep:** `2026-04-14-scout-exclusion-groups-fix-design.md` (still open work), `2026-04-15-repo-cleanup-design.md` (this cleanup's own spec).

- [ ] **Step 1: List current contents**

Run: `ls docs/superpowers/specs/`
Expected: shows the files above plus the two to keep.

- [ ] **Step 2: Delete shipped specs**

```bash
rm docs/superpowers/specs/2026-04-13-scout-port-design.md
rm docs/superpowers/specs/2026-04-14-phase-locked-trait-seeded-design.md
rm docs/superpowers/specs/2026-04-14-scout-cli-debug-tool-design.md
rm docs/superpowers/specs/2026-04-14-scout-lab-sidecar-design.md
rm docs/superpowers/specs/2026-04-14-scout-perf-sprint-design.md
rm docs/superpowers/specs/2026-04-14-scout-role-filters-and-display-design.md
rm docs/superpowers/specs/2026-04-14-scout-why-this-comp-design.md
rm docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md
```

- [ ] **Step 3: Verify keep-list survived**

Run: `ls docs/superpowers/specs/`
Expected: exactly two files — `2026-04-14-scout-exclusion-groups-fix-design.md` and `2026-04-15-repo-cleanup-design.md`.

If any shipped spec is still present or a kept file is missing, STOP and fix before committing.

---

## Task 4: Delete shipped superpowers plans

**Files:**
- Delete, from `docs/superpowers/plans/`:
  - `2026-04-13-scout-port-plan.md`
  - `2026-04-14-phase-locked-trait-seeded.md`
  - `2026-04-14-scout-cli-debug-tool.md`
  - `2026-04-14-scout-lab-sidecar.md`
  - `2026-04-14-scout-perf-sprint-phase-a.md`
  - `2026-04-14-scout-role-filters-and-display.md`
  - `2026-04-14-scout-why-this-comp-plan.md`
  - `2026-04-15-scout-perf-sprint-phase-c.md`
  - `2026-04-15-scout-refactor-cleanup-plan.md`
- **Keep:** `2026-04-14-scout-exclusion-groups-fix-plan.md` (still open), `metatft-api-notes.md` (API notes, not a plan), `2026-04-15-repo-cleanup-plan.md` (this plan).

- [ ] **Step 1: Delete shipped plans**

```bash
rm docs/superpowers/plans/2026-04-13-scout-port-plan.md
rm docs/superpowers/plans/2026-04-14-phase-locked-trait-seeded.md
rm docs/superpowers/plans/2026-04-14-scout-cli-debug-tool.md
rm docs/superpowers/plans/2026-04-14-scout-lab-sidecar.md
rm docs/superpowers/plans/2026-04-14-scout-perf-sprint-phase-a.md
rm docs/superpowers/plans/2026-04-14-scout-role-filters-and-display.md
rm docs/superpowers/plans/2026-04-14-scout-why-this-comp-plan.md
rm docs/superpowers/plans/2026-04-15-scout-perf-sprint-phase-c.md
rm docs/superpowers/plans/2026-04-15-scout-refactor-cleanup-plan.md
```

- [ ] **Step 2: Verify keep-list survived**

Run: `ls docs/superpowers/plans/`
Expected: exactly three files — `2026-04-14-scout-exclusion-groups-fix-plan.md`, `metatft-api-notes.md`, `2026-04-15-repo-cleanup-plan.md`.

---

## Task 5: Delete `docs/superpowers/research/`

**Files:**
- Delete: `docs/superpowers/research/` (entire directory — `scout-code-audit-2026-04-14.md`, `scout-perf-2026-04-14.md`).

- [ ] **Step 1: Delete the directory**

Run: `rm -rf docs/superpowers/research/`

- [ ] **Step 2: Verify**

Run: `ls docs/superpowers/research/ 2>&1`
Expected: "No such file or directory".

---

## Task 6: Commit docs cleanup (Tasks 3 + 4 + 5)

- [ ] **Step 1: Stage deletions**

```bash
git add -A docs/superpowers/
git status --short
```

Expected: many `D  docs/superpowers/...` entries. No other unrelated changes.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(superpowers): prune shipped specs, plans, and research audits

Removes design docs and plans for work already shipped (port, perf
sprint, refactor R, why-this-comp, cli-debug, lab-sidecar, role
filters, phase-locked-trait-seeded) plus the two historical scout
audits. Keeps the still-open exclusion-groups-fix pair, the
metatft-api-notes reference, and this cleanup's own spec/plan.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Drop `legacy/...` path refs in `ScoutContextBuilder.php`

**Files:**
- Modify: `app/Services/Scout/ScoutContextBuilder.php` (lines 16–23, 113–117, 277–279)

- [ ] **Step 1: Rewrite the class-level docblock (lines 16–23)**

Replace:

```php
/**
 * Assembles the JSON payload that the scout Web Worker consumes.
 *
 * Shape mirrors legacy `ctx` object from
 * `legacy/tft-generator/client/src/workers/scout.worker.js` so the port
 * can consume it 1:1 with minimal changes. See the spec for full field
 * definitions.
 */
```

With:

```php
/**
 * Assembles the JSON payload that the scout Web Worker consumes.
 *
 * Shape matches the `ctx` object expected by
 * `resources/js/workers/scout/engine.ts`. See the spec for full field
 * definitions.
 */
```

- [ ] **Step 2: Rewrite the exclusion-groups method docblock (lines 113–117)**

Replace:

```php
    /**
     * Convert `base_champion_id` self-FK into the shape the legacy
     * algorithm expects: a list of mutually-exclusive apiName groups.
```

With:

```php
    /**
     * Convert `base_champion_id` self-FK into the shape the scout
     * algorithm expects: a list of mutually-exclusive apiName groups.
```

- [ ] **Step 3: Rewrite the inline `units`-key comment (lines 277–279)**

Replace:

```php
                // Worker (`engine.ts`) reads this as `meta.units` —
                // legacy port expected the `units` key. Keep the
                // shape matching the worker to avoid another crash.
```

With:

```php
                // Worker (`engine.ts`) reads this as `meta.units`.
                // Keep the key name in sync with the worker.
```

- [ ] **Step 4: Verify no `legacy` left in the file**

Run: `grep -n "legacy" app/Services/Scout/ScoutContextBuilder.php`
Expected: no output.

---

## Task 8: Drop `legacy/...` path ref in `workers/scout/index.ts`

**Files:**
- Modify: `resources/js/workers/scout/index.ts` (lines 1–5)

- [ ] **Step 1: Rewrite the header comment**

Replace:

```ts
/// <reference lib="webworker" />
// Scout Web Worker. Ported from
// legacy/tft-generator/client/src/workers/scout.worker.js.
// Fetches /api/scout/context on first message, then runs the generate
// / roadTo pipelines from the ported algorithm modules.
```

With:

```ts
/// <reference lib="webworker" />
// Scout Web Worker. Fetches /api/scout/context on first message, then
// runs the generate / roadTo pipelines from the scout algorithm
// modules in this folder.
```

- [ ] **Step 2: Verify no `legacy` left in the file**

Run: `grep -n "legacy" resources/js/workers/scout/index.ts`
Expected: no output.

---

## Task 9: Global verification

- [ ] **Step 1: Confirm no dangling `legacy/` path refs in code**

Run:

```bash
grep -rn "legacy/" app/ resources/ 2>&1
```

Expected: no output. If there are hits, they must be investigated and cleaned before committing.

- [ ] **Step 2: Broader `legacy` sanity check**

Run:

```bash
grep -rni "legacy" app/ resources/ 2>&1
```

Expected: no output, or only hits that are clearly unrelated (e.g. a variable named `legacyFlag` in a domain sense). Review each hit; if any still reference the deleted `legacy/` tree, update them.

- [ ] **Step 3: Lint**

Run: `npm run lint:check`
Expected: exit 0 (or identical output to the baseline captured in Pre-flight). No new errors/warnings introduced.

- [ ] **Step 4: Type check**

Run: `npm run types:check`
Expected: exit 0 (or identical to baseline).

- [ ] **Step 5: PHP smoke test**

Run: `php artisan test`
Expected: same pass/fail set as baseline. Any new failure must be investigated — it would have to come from the two `ScoutContextBuilder.php` comment edits, which cannot affect runtime.

If `php artisan` itself fails to resolve, first run `source ~/.bashrc` and retry (Git Bash wrapper for Herd PHP).

---

## Task 10: Commit comment updates

- [ ] **Step 1: Stage edits**

```bash
git add app/Services/Scout/ScoutContextBuilder.php resources/js/workers/scout/index.ts
git status --short
```

Expected: exactly two `M` entries.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(scout): drop legacy path refs in comments

The `legacy/tft-generator/...` tree was removed in the previous
commit, so the path references in these two comments would dangle.
Rewrite them to point at the live scout worker instead.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Final status check**

Run: `git status --short`
Expected: only `?? CLAUDE.md` (untracked, out of scope) remains.

- [ ] **Step 4: Log summary**

Run: `git log --oneline -5`
Expected: the four cleanup commits on top (legacy tree, docs/legacy, superpowers prune, scout comments), with the spec commit from brainstorming right below them.
