---
date: 2026-04-15
status: draft
topic: Repo cleanup — remove legacy Node stack and shipped superpowers docs
---

# Repo Cleanup — Legacy + Shipped Docs

## Motivation

After the Node→Laravel port (2026-04-12) and subsequent scout port, perf sprint,
and refactor R work, the repo carries a lot of dead weight:

- `legacy/` — original Node stack (259K, 37 files), no runtime imports, only
  referenced in 2 code comments.
- `docs/legacy/` — 20 plans/specs from the Node stack era.
- `docs/superpowers/specs/` + `plans/` — shipped work (port, perf sprint, R
  refactor, why-this-comp, cli-debug, lab-sidecar, role-filters, etc.).
- `docs/superpowers/research/` — two historical baseline audits.

All of this noise lands in `grep`/`rg` results and complicates navigation. Git
history preserves every removed file, so deletion is non-destructive.

## Scope

### Delete

- `legacy/` (entire tree)
- `docs/legacy/` (entire tree)
- `docs/superpowers/specs/*` — **except** `2026-04-14-scout-exclusion-groups-fix-design.md`
- `docs/superpowers/plans/*` — **except** `2026-04-14-scout-exclusion-groups-fix-plan.md`
  and `metatft-api-notes.md`
- `docs/superpowers/research/` (entire tree — `scout-code-audit-2026-04-14.md`,
  `scout-perf-2026-04-14.md`)

### Keep (untouched)

- `docs/research/` — live reference (tft-data-sources, hash-discovery, etc.)
- `docs/knowledge-base/` — tierlists, mechanics
- `docs/algorithm-overview.md`, `docs/champion-ability-pipeline.md`,
  `docs/schema-plan.md`
- `docs/contrib/`
- `CLAUDE.md` (untracked, out of scope)

### Code comment updates

Two files reference `legacy/...` paths in comments. These paths will 404 after
deletion, so the comments need rephrasing to drop the path while preserving the
"shape mirrors scout worker ctx" intent.

- `app/Services/Scout/ScoutContextBuilder.php` — 4 references (lines 19, 20,
  114, 278). Rewrite to reference the live scout worker instead of the legacy
  file path.
- `resources/js/workers/scout/index.ts` — 1 reference (line 3). Same fix.

## Non-goals

- No refactoring of kept code.
- No changes to `CLAUDE.md` or auto-memory.
- No archive folder (agresywny wariant — git history is the archive).

## Verification

After deletion and comment updates:

1. `grep -r "legacy/" app/ resources/` → 0 hits.
2. `grep -r "legacy" app/ resources/` → 0 hits (or only unrelated matches).
3. `npm run lint:check` — clean.
4. `npm run types:check` — clean.
5. `php artisan test` — smoke (no new failures vs. baseline).
6. `git status` — only intentional deletions + 2 edits.

## Commits

1. `chore: remove legacy Node stack and shipped docs`
   — bulk deletion of `legacy/`, `docs/legacy/`, shipped superpowers docs,
   research audits.
2. `docs(scout): drop legacy path refs in comments`
   — `ScoutContextBuilder.php` + `workers/scout/index.ts`.

## Risks

- **None runtime.** `legacy/` has no imports into `app/` or `resources/`.
- Historical lookups still work via `git log --all -- <path>` and
  `git show <sha>:<path>`.
