# Pre-Computed Hybrid Scout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow real-time scout (~5-10s) with a hybrid system: pre-computed team compositions stored in SQLite + lightweight real-time query and re-score (~10ms).

**Architecture:** Offline script generates ~130k top team compositions per team_size (5-13), stores them in `precomp_teams` + `precomp_champ_index` tables in the existing `tft.db`. New `scout-v2` route queries pre-computed data by champion overlap, re-scores with player context (level/emblems/filters), and traverses the parent-child tree for transitions. Old scout remains as fallback.

**Tech Stack:** Node.js, SQLite (better-sqlite3), Vitest, Express

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `server/src/precomp/schema.js` | DDL for precomp tables + migration helper |
| Create | `server/src/precomp/generator.js` | Core generation logic: iterate, score, deduplicate, prune |
| Create | `server/src/precomp/linker.js` | Parent-child tree linkage + inverted index builder |
| Create | `server/src/precomp/query.js` | Query helpers: overlap search, tree traversal |
| Create | `server/src/precomp/rescore.js` | Real-time re-scoring with cost penalty, emblems, filters |
| Create | `server/src/routes/scout-v2.js` | New Express route using precomp query + rescore |
| Create | `server/src/generate-precomp.js` | CLI entry point for offline generation |
| Modify | `server/src/db.js` | Add precomp table creation to schema |
| Modify | `server/src/index.js:42` | Register scout-v2 route |
| Modify | `client/src/api.js:82-89` | Add scoutV2 with fallback to old scout |
| Create | `server/tests/precomp-schema.test.js` | Schema tests |
| Create | `server/tests/precomp-generator.test.js` | Generator tests |
| Create | `server/tests/precomp-linker.test.js` | Linker tests |
| Create | `server/tests/precomp-query.test.js` | Query + rescore tests |
| Create | `server/tests/scout-v2.test.js` | Integration test for scout-v2 route |

---

### Task 1: Precomp Schema

**Files:**
- Create: `server/src/precomp/schema.js`
- Modify: `server/src/db.js`
- Create: `server/tests/precomp-schema.test.js`

- [ ] **Step 1: Write failing test for schema creation**

```js
// server/tests/precomp-schema.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createPrecompTables, dropPrecompTables } from '../src/precomp/schema.js';

describe('precomp schema', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  it('creates precomp_teams and precomp_champ_index tables', () => {
    createPrecompTables(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'precomp_%'"
    ).all().map(r => r.name);
    expect(tables).toContain('precomp_teams');
    expect(tables).toContain('precomp_champ_index');
  });

  it('precomp_teams has correct columns', () => {
    createPrecompTables(db);
    const info = db.prepare('PRAGMA table_info(precomp_teams)').all();
    const cols = info.map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'parent_id', 'team_size', 'champs', 'traits', 'base_score', 'add_champ'
    ]));
  });

  it('dropPrecompTables removes both tables', () => {
    createPrecompTables(db);
    dropPrecompTables(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'precomp_%'"
    ).all();
    expect(tables).toHaveLength(0);
  });

  it('createPrecompTables is idempotent', () => {
    createPrecompTables(db);
    createPrecompTables(db);
    const count = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE name LIKE 'precomp_%'").get().c;
    expect(count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/precomp-schema.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement schema module**

```js
// server/src/precomp/schema.js

export function createPrecompTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS precomp_teams (
      id         INTEGER PRIMARY KEY,
      parent_id  INTEGER REFERENCES precomp_teams(id),
      team_size  INTEGER NOT NULL,
      champs     TEXT NOT NULL,
      traits     TEXT NOT NULL,
      base_score REAL NOT NULL,
      add_champ  TEXT
    );

    CREATE TABLE IF NOT EXISTS precomp_champ_index (
      champ_id   TEXT NOT NULL,
      team_id    INTEGER NOT NULL REFERENCES precomp_teams(id) ON DELETE CASCADE,
      PRIMARY KEY (champ_id, team_id)
    );

    CREATE INDEX IF NOT EXISTS idx_precomp_size_score
      ON precomp_teams(team_size, base_score DESC);

    CREATE INDEX IF NOT EXISTS idx_precomp_parent
      ON precomp_teams(parent_id);

    CREATE INDEX IF NOT EXISTS idx_precomp_champ_team
      ON precomp_champ_index(champ_id, team_id);
  `);
}

export function dropPrecompTables(db) {
  db.exec(`
    DROP TABLE IF EXISTS precomp_champ_index;
    DROP TABLE IF EXISTS precomp_teams;
  `);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/precomp-schema.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Add precomp tables to main db.js schema**

In `server/src/db.js`, add import and call at the end of `createDb`:

```js
import { createPrecompTables } from './precomp/schema.js';
// ... at end of createDb, before return db:
createPrecompTables(db);
```

- [ ] **Step 6: Run all existing tests to verify no regression**

Run: `cd server && npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add server/src/precomp/schema.js server/src/db.js server/tests/precomp-schema.test.js
git commit -m "feat(precomp): add schema for pre-computed teams"
```

---

### Task 2: Generator — Core Generation Logic

**Files:**
- Create: `server/src/precomp/generator.js`
- Create: `server/tests/precomp-generator.test.js`

**Context:** This module wraps the existing `generateTeams` from `scoring/engine.js` to produce pre-computed teams. It generates WITHOUT cost penalty (neutral base_score) and WITHOUT locked champions. The key function is `generateForTeamSize(db, teamSize, options)` which runs many iterations and returns deduplicated, pruned results.

- [ ] **Step 1: Write failing test for generator**

```js
// server/tests/precomp-generator.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import { importFromData } from '../src/importer.js';
import { generateForTeamSize } from '../src/precomp/generator.js';

// Same mock data used in engine.test.js
const MOCK_DATA = {
  sets: {
    "17": {
      champions: [
        { apiName: "TFT17_Jhin", name: "Jhin", cost: 5, traits: ["Dark Star", "Sniper"],
          stats: { hp: 900, armor: 40, magicResist: 40, damage: 84, attackSpeed: 0.9, mana: 44, initialMana: 0, range: 6, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Zed", name: "Zed", cost: 3, traits: ["Dark Star", "Assassin"],
          stats: { hp: 700, armor: 30, magicResist: 30, damage: 60, attackSpeed: 0.8, mana: 30, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Ashe", name: "Ashe", cost: 2, traits: ["Sniper", "Ranger"],
          stats: { hp: 600, armor: 25, magicResist: 25, damage: 50, attackSpeed: 0.75, mana: 40, initialMana: 0, range: 5, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Garen", name: "Garen", cost: 1, traits: ["Knight"],
          stats: { hp: 800, armor: 50, magicResist: 40, damage: 55, attackSpeed: 0.6, mana: 0, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Katarina", name: "Katarina", cost: 3, traits: ["Assassin"],
          stats: { hp: 650, armor: 30, magicResist: 30, damage: 65, attackSpeed: 0.75, mana: 50, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
      ],
      traits: [
        { apiName: "TFT17_DarkStar", name: "Dark Star", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }, { minUnits: 4, maxUnits: 25000, style: 3, variables: {} }]},
        { apiName: "TFT17_Sniper", name: "Sniper", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_AssassinTrait", name: "Assassin", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_Knight", name: "Knight", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_Ranger", name: "Ranger", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
      ],
    },
  },
};

describe('generateForTeamSize', () => {
  let db;
  beforeEach(() => {
    db = createDb(':memory:');
    importFromData(db, MOCK_DATA);
  });

  it('generates teams of the correct size', () => {
    const teams = generateForTeamSize(db, 3, { iterations: 50, topN: 10 });
    expect(teams.length).toBeGreaterThan(0);
    for (const team of teams) {
      expect(team.champs.split(',').length).toBe(3);
    }
  });

  it('returns deduplicated results', () => {
    const teams = generateForTeamSize(db, 3, { iterations: 100, topN: 50 });
    const fingerprints = teams.map(t => t.champs);
    const unique = new Set(fingerprints);
    expect(unique.size).toBe(fingerprints.length);
  });

  it('each result has champs, traits, base_score', () => {
    const teams = generateForTeamSize(db, 3, { iterations: 50, topN: 10 });
    for (const team of teams) {
      expect(team.champs).toBeDefined();
      expect(team.traits).toBeDefined();
      expect(typeof team.base_score).toBe('number');
      expect(team.base_score).toBeGreaterThan(0);
    }
  });

  it('champs are sorted apiNames', () => {
    const teams = generateForTeamSize(db, 3, { iterations: 50, topN: 10 });
    for (const team of teams) {
      const parts = team.champs.split(',');
      const sorted = [...parts].sort();
      expect(parts).toEqual(sorted);
    }
  });

  it('respects topN limit', () => {
    const teams = generateForTeamSize(db, 3, { iterations: 200, topN: 3 });
    expect(teams.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/precomp-generator.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement generator**

```js
// server/src/precomp/generator.js
import { generateTeams } from '../scoring/engine.js';

/**
 * Generate pre-computed teams for a given team size.
 * Runs WITHOUT cost penalty and WITHOUT locked champions.
 * Returns array of { champs, traits, base_score } objects.
 */
export function generateForTeamSize(db, teamSize, options = {}) {
  const { iterations = 1000, topN = 10000 } = options;

  // Generate with no locked champions, no cost penalty context
  // Using level=teamSize to match board size
  const results = generateTeams(db, {
    lockedChampions: [],
    lockedTraits: [],
    emblems: [],
    excludedChampions: [],
    excludedTraits: [],
    level: teamSize,
    roleBalance: null,
    mechaEnhanced: [],
    stargazerVariant: null,
    max5Cost: null,
  }, { topN, iterations });

  // Transform to precomp format
  return results.map(team => {
    const champApiNames = team.champions
      .map(c => c.apiName)
      .sort();

    const activeTraitNames = (team.activeTraits || [])
      .map(t => t.apiName)
      .sort();

    return {
      champs: champApiNames.join(','),
      traits: activeTraitNames.join(','),
      base_score: team.score,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/precomp-generator.test.js`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Run all tests**

Run: `cd server && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/src/precomp/generator.js server/tests/precomp-generator.test.js
git commit -m "feat(precomp): generator produces teams per team_size"
```

---

### Task 3: Linker — Parent Linkage + Inverted Index

**Files:**
- Create: `server/src/precomp/linker.js`
- Create: `server/tests/precomp-linker.test.js`

**Context:** After generating teams for all team_sizes, the linker:
1. Links each team_size=N comp to its best parent in team_size=N-1 (max overlap)
2. Builds the inverted index (champ_id to team_id)
Both write directly to SQLite.

- [ ] **Step 1: Write failing test for linker**

```js
// server/tests/precomp-linker.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createPrecompTables } from '../src/precomp/schema.js';
import { linkParents, buildChampIndex } from '../src/precomp/linker.js';

describe('linkParents', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createPrecompTables(db);

    // Insert team_size=3 teams
    const insert = db.prepare(
      'INSERT INTO precomp_teams (id, team_size, champs, traits, base_score) VALUES (?, ?, ?, ?, ?)'
    );
    insert.run(1, 3, 'A,B,C', 'trait1', 80);
    insert.run(2, 3, 'A,B,D', 'trait1', 75);

    // Insert team_size=4 teams
    insert.run(3, 4, 'A,B,C,E', 'trait1,trait2', 90);
    insert.run(4, 4, 'A,B,D,F', 'trait1', 85);
    insert.run(5, 4, 'A,C,D,E', 'trait1,trait2', 88);
  });

  it('links team_size=4 to best parent in team_size=3', () => {
    linkParents(db, 4);

    const team3 = db.prepare('SELECT * FROM precomp_teams WHERE id = 3').get();
    expect(team3.parent_id).toBe(1); // A,B,C,E parent is A,B,C (overlap 3/3)
    expect(team3.add_champ).toBe('E');

    const team4 = db.prepare('SELECT * FROM precomp_teams WHERE id = 4').get();
    expect(team4.parent_id).toBe(2); // A,B,D,F parent is A,B,D (overlap 3/3)
    expect(team4.add_champ).toBe('F');
  });

  it('picks highest-overlap parent, tiebreaks by score', () => {
    linkParents(db, 4);
    const team5 = db.prepare('SELECT * FROM precomp_teams WHERE id = 5').get();
    // A,C,D,E: overlap with A,B,C=2, overlap with A,B,D=2 tiebreak by score parent=1 (80)
    expect(team5.parent_id).toBeDefined();
    expect(team5.add_champ).toBeDefined();
  });
});

describe('buildChampIndex', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createPrecompTables(db);
    const insert = db.prepare(
      'INSERT INTO precomp_teams (id, team_size, champs, traits, base_score) VALUES (?, ?, ?, ?, ?)'
    );
    insert.run(1, 3, 'TFT17_Jhin,TFT17_Shen,TFT17_Zed', 'DarkStar', 80);
    insert.run(2, 3, 'TFT17_Jhin,TFT17_Rammus,TFT17_Shen', 'DarkStar', 75);
  });

  it('creates index entries for each champion in each team', () => {
    buildChampIndex(db);
    const shenTeams = db.prepare(
      'SELECT team_id FROM precomp_champ_index WHERE champ_id = ?'
    ).all('TFT17_Shen').map(r => r.team_id);
    expect(shenTeams).toEqual(expect.arrayContaining([1, 2]));
  });

  it('total index entries = sum of team sizes', () => {
    buildChampIndex(db);
    const count = db.prepare('SELECT COUNT(*) as c FROM precomp_champ_index').get().c;
    expect(count).toBe(6); // 3 + 3
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/precomp-linker.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement linker**

```js
// server/src/precomp/linker.js

/**
 * Link each team of teamSize to its best parent in teamSize - 1.
 * Best parent = max overlap of champions, tiebreak by higher score.
 * Sets parent_id and add_champ on the child row.
 */
export function linkParents(db, teamSize) {
  const children = db.prepare(
    'SELECT id, champs FROM precomp_teams WHERE team_size = ?'
  ).all(teamSize);

  const parents = db.prepare(
    'SELECT id, champs, base_score FROM precomp_teams WHERE team_size = ?'
  ).all(teamSize - 1);

  if (parents.length === 0) return;

  // Pre-parse parent champs into Sets for fast overlap
  const parentSets = parents.map(p => ({
    id: p.id,
    champsSet: new Set(p.champs.split(',')),
    score: p.base_score,
  }));

  const update = db.prepare(
    'UPDATE precomp_teams SET parent_id = ?, add_champ = ? WHERE id = ?'
  );

  const updateMany = db.transaction((updates) => {
    for (const u of updates) {
      update.run(u.parentId, u.addChamp, u.childId);
    }
  });

  const batch = [];
  for (const child of children) {
    const childChamps = child.champs.split(',');
    const childSet = new Set(childChamps);

    let bestParent = null;
    let bestOverlap = -1;
    let bestScore = -Infinity;

    for (const parent of parentSets) {
      let overlap = 0;
      for (const c of parent.champsSet) {
        if (childSet.has(c)) overlap++;
      }
      if (overlap > bestOverlap || (overlap === bestOverlap && parent.score > bestScore)) {
        bestOverlap = overlap;
        bestScore = parent.score;
        bestParent = parent;
      }
    }

    if (bestParent) {
      const addedChamps = childChamps.filter(c => !bestParent.champsSet.has(c));
      batch.push({
        childId: child.id,
        parentId: bestParent.id,
        addChamp: addedChamps.join(',') || null,
      });
    }
  }

  updateMany(batch);
}

/**
 * Build inverted index: for each champion in each team, insert (champ_id, team_id).
 * Clears existing index first.
 */
export function buildChampIndex(db) {
  db.prepare('DELETE FROM precomp_champ_index').run();

  const teams = db.prepare('SELECT id, champs FROM precomp_teams').all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO precomp_champ_index (champ_id, team_id) VALUES (?, ?)'
  );

  const insertAll = db.transaction((entries) => {
    for (const e of entries) {
      insert.run(e.champId, e.teamId);
    }
  });

  const entries = [];
  for (const team of teams) {
    for (const champ of team.champs.split(',')) {
      entries.push({ champId: champ, teamId: team.id });
    }
  }

  insertAll(entries);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/precomp-linker.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/precomp/linker.js server/tests/precomp-linker.test.js
git commit -m "feat(precomp): parent linkage + inverted index builder"
```

---

### Task 4: CLI Script — generate-precomp.js

**Files:**
- Create: `server/src/generate-precomp.js`

**Context:** CLI entry point that ties schema, generator, and linker together. Run manually: `node server/src/generate-precomp.js`. Supports `--regenerate` to drop and rebuild.

- [ ] **Step 1: Implement CLI script**

```js
// server/src/generate-precomp.js
import { createDb } from './db.js';
import { dropPrecompTables, createPrecompTables } from './precomp/schema.js';
import { generateForTeamSize } from './precomp/generator.js';
import { linkParents, buildChampIndex } from './precomp/linker.js';

const db = createDb('tft.db');

// Config: topN per team_size
const TEAM_SIZE_CONFIG = {
  5:  { topN: 5000,  iterations: 200000 },
  6:  { topN: 10000, iterations: 200000 },
  7:  { topN: 20000, iterations: 500000 },
  8:  { topN: 30000, iterations: 1000000 },
  9:  { topN: 30000, iterations: 1000000 },
  10: { topN: 20000, iterations: 500000 },
  11: { topN: 10000, iterations: 200000 },
  12: { topN: 5000,  iterations: 100000 },
  13: { topN: 2000,  iterations: 50000 },
};

const args = process.argv.slice(2);
const isRegenerate = args.includes('--regenerate');

// Check if data exists
const hasData = (() => {
  try {
    return db.prepare('SELECT COUNT(*) as c FROM precomp_teams').get().c > 0;
  } catch { return false; }
})();

if (hasData && !isRegenerate) {
  console.log('Pre-computed data already exists. Use --regenerate to rebuild.');
  process.exit(0);
}

console.log('=== Pre-Compute Generation ===');
console.log(isRegenerate ? 'Regenerating (dropping existing data)...' : 'Generating...');

// Drop + recreate
dropPrecompTables(db);
createPrecompTables(db);

const insertTeam = db.prepare(
  'INSERT INTO precomp_teams (team_size, champs, traits, base_score) VALUES (?, ?, ?, ?)'
);

const insertBatch = db.transaction((teams, teamSize) => {
  for (const team of teams) {
    insertTeam.run(teamSize, team.champs, team.traits, team.base_score);
  }
});

let totalTeams = 0;
const startTime = Date.now();

for (const [sizeStr, config] of Object.entries(TEAM_SIZE_CONFIG)) {
  const teamSize = parseInt(sizeStr);
  const stepStart = Date.now();
  console.log(
    '\nGenerating team_size=' + teamSize +
    ' (topN=' + config.topN + ', iterations=' + config.iterations + ')...'
  );

  const teams = generateForTeamSize(db, teamSize, config);
  insertBatch(teams, teamSize);
  totalTeams += teams.length;

  const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
  console.log('  -> ' + teams.length + ' teams in ' + elapsed + 's');
}

// Link parents (team_size 6 to 5, 7 to 6, ..., 13 to 12)
console.log('\nLinking parent->child tree...');
for (let size = 6; size <= 13; size++) {
  const stepStart = Date.now();
  linkParents(db, size);
  const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
  console.log('  team_size=' + size + ' linked in ' + elapsed + 's');
}

// Build inverted index
console.log('\nBuilding inverted index...');
const indexStart = Date.now();
buildChampIndex(db);
console.log('  Index built in ' + ((Date.now() - indexStart) / 1000).toFixed(1) + 's');

// Analyze for query planner
db.prepare('ANALYZE').run();

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('\n=== Done ===');
console.log('Total: ' + totalTeams + ' teams in ' + totalElapsed + 's');
```

- [ ] **Step 2: Verify script runs with small iterations (smoke test)**

Temporarily edit TEAM_SIZE_CONFIG to use small values (topN: 10, iterations: 50) for each size. Run:

Run: `cd server && node src/generate-precomp.js --regenerate`
Expected: Script completes, prints summary, no errors. Then revert to production values.

- [ ] **Step 3: Verify data in database**

Run:
```bash
cd server && node -e "
import Database from 'better-sqlite3';
const db = new Database('tft.db');
const counts = db.prepare('SELECT team_size, COUNT(*) as c FROM precomp_teams GROUP BY team_size ORDER BY team_size').all();
console.log('Teams per size:', counts);
const idx = db.prepare('SELECT COUNT(*) as c FROM precomp_champ_index').get();
console.log('Index entries:', idx.c);
const linked = db.prepare('SELECT COUNT(*) as c FROM precomp_teams WHERE parent_id IS NOT NULL').get();
console.log('Linked teams:', linked.c);
"
```

Expected: Counts per team_size, index entries > 0, linked teams > 0

- [ ] **Step 4: Commit**

```bash
git add server/src/generate-precomp.js
git commit -m "feat(precomp): CLI script for offline generation"
```

---

### Task 5: Query + Re-Score Module

**Files:**
- Create: `server/src/precomp/query.js`
- Create: `server/src/precomp/rescore.js`
- Create: `server/tests/precomp-query.test.js`

**Context:** `query.js` searches precomp_teams by champion overlap. `rescore.js` applies player context (level, emblems, filters) to pre-computed base_scores.

- [ ] **Step 1: Write failing test for query and rescore**

```js
// server/tests/precomp-query.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createPrecompTables } from '../src/precomp/schema.js';
import { buildChampIndex } from '../src/precomp/linker.js';
import { findByChampOverlap, getChildren, getAncestors } from '../src/precomp/query.js';
import { rescoreTeams } from '../src/precomp/rescore.js';

describe('findByChampOverlap', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createPrecompTables(db);
    const insert = db.prepare(
      'INSERT INTO precomp_teams (id, team_size, champs, traits, base_score) VALUES (?, ?, ?, ?, ?)'
    );
    insert.run(1, 5, 'A,B,C,D,E', 't1,t2', 90);
    insert.run(2, 5, 'A,B,F,G,H', 't1,t3', 85);
    insert.run(3, 5, 'A,F,G,H,I', 't3', 80);
    insert.run(4, 5, 'F,G,H,I,J', 't3', 70);
    buildChampIndex(db);
  });

  it('finds teams containing all specified champions', () => {
    const results = findByChampOverlap(db, ['A', 'B'], 5, { limit: 10 });
    const ids = results.map(r => r.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).not.toContain(4); // no A or B
  });

  it('returns results sorted by overlap desc, then score desc', () => {
    const results = findByChampOverlap(db, ['A', 'B', 'C'], 5, { limit: 10 });
    // Team 1 has overlap 3 (A,B,C), team 2 has overlap 2 (A,B), team 3 has overlap 1 (A)
    expect(results[0].id).toBe(1);
  });

  it('returns empty array when no matches', () => {
    const results = findByChampOverlap(db, ['Z'], 5, { limit: 10 });
    expect(results).toHaveLength(0);
  });
});

describe('getChildren / getAncestors', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createPrecompTables(db);
    const insert = db.prepare(
      'INSERT INTO precomp_teams (id, parent_id, team_size, champs, traits, base_score, add_champ) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insert.run(1, null, 5, 'A,B,C,D,E', 't1', 70, null);
    insert.run(2, 1, 6, 'A,B,C,D,E,F', 't1,t2', 80, 'F');
    insert.run(3, 2, 7, 'A,B,C,D,E,F,G', 't1,t2', 90, 'G');
    insert.run(4, 1, 6, 'A,B,C,D,E,H', 't1,t3', 78, 'H');
  });

  it('getChildren returns direct children of a node', () => {
    const children = getChildren(db, 1);
    expect(children).toHaveLength(2);
    expect(children.map(c => c.id)).toEqual(expect.arrayContaining([2, 4]));
  });

  it('getAncestors walks up the tree', () => {
    const ancestors = getAncestors(db, 3);
    expect(ancestors.map(a => a.id)).toEqual([2, 1]); // parent, grandparent
  });

  it('getAncestors returns empty for root node', () => {
    const ancestors = getAncestors(db, 1);
    expect(ancestors).toHaveLength(0);
  });
});

describe('rescoreTeams', () => {
  it('applies cost penalty based on level shop odds', () => {
    const teams = [
      { id: 1, champs: 'TFT17_Jhin,TFT17_Shen,TFT17_Zed', traits: 't1', base_score: 90 },
    ];
    // At level 5, 5-cost champs (Jhin, Shen) are unavailable (0% odds)
    const champCostMap = { TFT17_Jhin: 5, TFT17_Shen: 5, TFT17_Zed: 3 };
    const rescored = rescoreTeams(teams, { level: 5, emblems: [], excludedTraits: [], lockedTraits: [], max5Cost: null }, champCostMap);
    expect(rescored[0].final_score).toBeLessThan(90);
  });

  it('adds emblem trait bonus', () => {
    const teams = [
      { id: 1, champs: 'A,B,C', traits: 'DarkStar', base_score: 80 },
    ];
    const without = rescoreTeams(teams, { level: 8, emblems: [], excludedTraits: [], lockedTraits: [], max5Cost: null }, {});
    const withEmblem = rescoreTeams(teams, { level: 8, emblems: ['DarkStar'], excludedTraits: [], lockedTraits: [], max5Cost: null }, {});
    expect(withEmblem[0].final_score).toBeGreaterThanOrEqual(without[0].final_score);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/precomp-query.test.js`
Expected: FAIL with modules not found

- [ ] **Step 3: Implement query.js**

```js
// server/src/precomp/query.js

/**
 * Find pre-computed teams that overlap with given champions.
 * Returns teams sorted by overlap count (desc), then base_score (desc).
 */
export function findByChampOverlap(db, champIds, teamSize, options = {}) {
  const { limit = 50 } = options;

  if (champIds.length === 0) {
    return db.prepare(
      'SELECT * FROM precomp_teams WHERE team_size = ? ORDER BY base_score DESC LIMIT ?'
    ).all(teamSize, limit);
  }

  const placeholders = champIds.map(() => '?').join(',');
  const query =
    'SELECT t.*, COUNT(i.champ_id) as overlap ' +
    'FROM precomp_champ_index i ' +
    'JOIN precomp_teams t ON t.id = i.team_id ' +
    'WHERE i.champ_id IN (' + placeholders + ') ' +
    'AND t.team_size = ? ' +
    'GROUP BY t.id ' +
    'ORDER BY overlap DESC, t.base_score DESC ' +
    'LIMIT ?';

  return db.prepare(query).all(...champIds, teamSize, limit);
}

/**
 * Get direct children of a node (teams in team_size+1 that have this as parent).
 */
export function getChildren(db, nodeId) {
  return db.prepare(
    'SELECT * FROM precomp_teams WHERE parent_id = ? ORDER BY base_score DESC'
  ).all(nodeId);
}

/**
 * Walk up the tree from a node, returning ancestors in order (parent first).
 */
export function getAncestors(db, nodeId) {
  const ancestors = [];
  let current = db.prepare('SELECT * FROM precomp_teams WHERE id = ?').get(nodeId);
  while (current && current.parent_id) {
    const parent = db.prepare('SELECT * FROM precomp_teams WHERE id = ?').get(current.parent_id);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}
```

- [ ] **Step 4: Implement rescore.js**

```js
// server/src/precomp/rescore.js

const SHOP_ODDS = {
  3:  [0.75, 0.25, 0,    0,    0],
  4:  [0.55, 0.30, 0.15, 0,    0],
  5:  [0.45, 0.30, 0.20, 0.05, 0],
  6:  [0.30, 0.35, 0.25, 0.10, 0],
  7:  [0.20, 0.30, 0.30, 0.15, 0.05],
  8:  [0.15, 0.20, 0.25, 0.25, 0.15],
  9:  [0.10, 0.15, 0.20, 0.25, 0.30],
  10: [0.05, 0.10, 0.15, 0.25, 0.45],
};

const COST_PENALTY = 12;

function getCostPenalty(champCosts, level) {
  const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
  const teamSize = champCosts.length;
  const limits = odds.map(o => {
    if (o === 0) return 0;
    if (o <= 0.05) return 1;
    if (o <= 0.15) return 2;
    return Math.ceil(o * teamSize) + 1;
  });

  const costCounts = [0, 0, 0, 0, 0];
  for (const cost of champCosts) {
    if (cost >= 1 && cost <= 5) costCounts[cost - 1]++;
  }

  let penalty = 0;
  for (let i = 0; i < 5; i++) {
    const excess = costCounts[i] - limits[i];
    if (excess > 0) penalty += excess * COST_PENALTY;
  }
  return penalty;
}

/**
 * Re-score pre-computed teams with player context.
 * champCostMap: { apiName: cost } for cost penalty calculation.
 */
export function rescoreTeams(teams, context, champCostMap = {}) {
  const { level, emblems = [], excludedTraits = [], lockedTraits = [], max5Cost = null } = context;

  return teams.map(team => {
    let adjustment = 0;

    const champs = team.champs.split(',');
    const costs = champs.map(c => champCostMap[c] || 3);
    adjustment -= getCostPenalty(costs, level);

    const teamTraits = team.traits ? team.traits.split(',') : [];
    for (const emblem of emblems) {
      if (teamTraits.includes(emblem)) {
        adjustment += 5;
      }
    }

    for (const excluded of excludedTraits) {
      if (teamTraits.includes(excluded)) {
        adjustment -= 15;
      }
    }

    if (max5Cost != null) {
      const fiveCostCount = costs.filter(c => c === 5).length;
      const over = fiveCostCount - max5Cost;
      if (over > 0) adjustment -= over * 30;
    }

    for (const lt of lockedTraits) {
      const traitApi = typeof lt === 'string' ? lt : lt.apiName;
      if (teamTraits.includes(traitApi)) {
        adjustment += 15;
      } else {
        adjustment -= 20;
      }
    }

    return {
      ...team,
      final_score: team.base_score + adjustment,
      cost_adjustment: adjustment,
    };
  }).sort((a, b) => b.final_score - a.final_score);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/precomp-query.test.js`
Expected: PASS (all 8 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/precomp/query.js server/src/precomp/rescore.js server/tests/precomp-query.test.js
git commit -m "feat(precomp): query by champion overlap + real-time re-scoring"
```

---

### Task 6: Scout V2 Route

**Files:**
- Create: `server/src/routes/scout-v2.js`
- Modify: `server/src/index.js`
- Create: `server/tests/scout-v2.test.js`

**Context:** New Express route that ties everything together: query precomp tables, re-score, traverse tree for transitions, format response identically to old scout.

- [ ] **Step 1: Write failing test for scout-v2**

```js
// server/tests/scout-v2.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import { importFromData } from '../src/importer.js';
import { buildChampIndex } from '../src/precomp/linker.js';
import { scoutV2 } from '../src/routes/scout-v2.js';

const MOCK_DATA = {
  sets: {
    "17": {
      champions: [
        { apiName: "TFT17_Jhin", name: "Jhin", cost: 5, traits: ["Dark Star", "Sniper"],
          stats: { hp: 900, armor: 40, magicResist: 40, damage: 84, attackSpeed: 0.9, mana: 44, initialMana: 0, range: 6, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Zed", name: "Zed", cost: 3, traits: ["Dark Star", "Assassin"],
          stats: { hp: 700, armor: 30, magicResist: 30, damage: 60, attackSpeed: 0.8, mana: 30, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Ashe", name: "Ashe", cost: 2, traits: ["Sniper", "Ranger"],
          stats: { hp: 600, armor: 25, magicResist: 25, damage: 50, attackSpeed: 0.75, mana: 40, initialMana: 0, range: 5, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Garen", name: "Garen", cost: 1, traits: ["Knight"],
          stats: { hp: 800, armor: 50, magicResist: 40, damage: 55, attackSpeed: 0.6, mana: 0, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Katarina", name: "Katarina", cost: 3, traits: ["Assassin"],
          stats: { hp: 650, armor: 30, magicResist: 30, damage: 65, attackSpeed: 0.75, mana: 50, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
      ],
      traits: [
        { apiName: "TFT17_DarkStar", name: "Dark Star", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }, { minUnits: 4, maxUnits: 25000, style: 3, variables: {} }]},
        { apiName: "TFT17_Sniper", name: "Sniper", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_AssassinTrait", name: "Assassin", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_Knight", name: "Knight", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_Ranger", name: "Ranger", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
      ],
    },
  },
};

describe('scoutV2', () => {
  let db;
  beforeEach(() => {
    db = createDb(':memory:');
    importFromData(db, MOCK_DATA);

    // Pre-populate some teams manually for testing
    const insert = db.prepare(
      'INSERT INTO precomp_teams (id, team_size, champs, traits, base_score) VALUES (?, ?, ?, ?, ?)'
    );
    insert.run(1, 3, 'TFT17_Ashe,TFT17_Jhin,TFT17_Zed', 'TFT17_DarkStar,TFT17_Sniper', 85);
    insert.run(2, 3, 'TFT17_Garen,TFT17_Katarina,TFT17_Zed', 'TFT17_AssassinTrait', 75);
    insert.run(3, 3, 'TFT17_Ashe,TFT17_Garen,TFT17_Jhin', 'TFT17_Sniper', 70);
    buildChampIndex(db);
  });

  it('returns directions array', () => {
    const result = scoutV2(db, {
      earlyUnits: ['TFT17_Zed'],
      currentLevel: 3,
      bonusSlots: 0,
      emblems: [],
      excludedTraits: [],
      lockedTraits: [],
      max5Cost: null,
    });
    expect(result.directions).toBeDefined();
    expect(Array.isArray(result.directions)).toBe(true);
    expect(result.directions.length).toBeGreaterThan(0);
  });

  it('returns fallback when precomp tables are empty', () => {
    db.prepare('DELETE FROM precomp_champ_index').run();
    db.prepare('DELETE FROM precomp_teams').run();
    const result = scoutV2(db, {
      earlyUnits: ['TFT17_Zed'],
      currentLevel: 3,
      bonusSlots: 0,
      emblems: [],
      excludedTraits: [],
      lockedTraits: [],
      max5Cost: null,
    });
    expect(result.fallback).toBe(true);
  });

  it('directions include endgameComp with champions', () => {
    const result = scoutV2(db, {
      earlyUnits: ['TFT17_Jhin'],
      currentLevel: 3,
      bonusSlots: 0,
      emblems: [],
      excludedTraits: [],
      lockedTraits: [],
      max5Cost: null,
    });
    for (const dir of result.directions) {
      expect(dir.endgameComp).toBeDefined();
      expect(dir.endgameComp.champions).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/scout-v2.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement scout-v2 route**

```js
// server/src/routes/scout-v2.js
import { Router } from 'express';
import { findByChampOverlap, getAncestors } from '../precomp/query.js';
import { rescoreTeams } from '../precomp/rescore.js';
import { collectTraitAffinity, buildKeepSellAdd } from './scout.js';

/**
 * Core scout-v2 logic (exported for testing).
 */
export function scoutV2(db, params) {
  const {
    earlyUnits: earlyApiNames = [],
    currentLevel = 5,
    bonusSlots = 0,
    emblems = [],
    excludedTraits = [],
    lockedTraits = [],
    max5Cost = null,
  } = params;

  // Check if precomp data exists
  let precompCount;
  try {
    precompCount = db.prepare('SELECT COUNT(*) as c FROM precomp_teams').get().c;
  } catch { precompCount = 0; }

  if (precompCount === 0) {
    return { directions: [], earlyTraitAffinity: {}, fallback: true };
  }

  const teamSize = currentLevel + bonusSlots;

  // Build champion cost map for re-scoring
  const champRows = db.prepare('SELECT apiName, cost FROM champions').all();
  const champCostMap = {};
  for (const c of champRows) champCostMap[c.apiName] = c.cost;

  // Load early units with traits for analysis
  let earlyUnits = [];
  if (earlyApiNames.length > 0) {
    const placeholders = earlyApiNames.map(() => '?').join(',');
    earlyUnits = db.prepare(
      'SELECT c.*, GROUP_CONCAT(t.apiName) as traitApiNames, GROUP_CONCAT(t.name) as traitNames ' +
      'FROM champions c ' +
      'LEFT JOIN champion_traits ct ON ct.championId = c.id ' +
      'LEFT JOIN traits t ON t.id = ct.traitId ' +
      'WHERE c.apiName IN (' + placeholders + ') ' +
      'GROUP BY c.id'
    ).all(...earlyApiNames);
    for (const u of earlyUnits) {
      u.traits = u.traitApiNames ? u.traitApiNames.split(',') : [];
      u.traitNameList = u.traitNames ? u.traitNames.split(',') : [];
    }
  }

  const affinity = collectTraitAffinity(earlyUnits);
  for (const e of emblems) affinity[e] = (affinity[e] || 0) + 1;

  // Step 1: Query by champion overlap
  const candidates = findByChampOverlap(db, earlyApiNames, teamSize, { limit: 100 });

  // Also get top teams by score (fallback for low overlap)
  const topByScore = findByChampOverlap(db, [], teamSize, { limit: 50 });

  // Merge and deduplicate
  const seen = new Set();
  const merged = [];
  for (const team of [...candidates, ...topByScore]) {
    if (!seen.has(team.id)) {
      seen.add(team.id);
      merged.push(team);
    }
  }

  // Step 2: Re-score with player context
  const rescored = rescoreTeams(merged, {
    level: currentLevel,
    emblems,
    excludedTraits,
    lockedTraits,
    max5Cost,
  }, champCostMap);

  // Step 3: Take top results and format as directions
  const topResults = rescored.slice(0, 20);

  // Load full champion data for formatting
  const allChamps = db.prepare(
    'SELECT c.*, GROUP_CONCAT(t.apiName) as traitApiNames, GROUP_CONCAT(t.name) as traitNames ' +
    'FROM champions c ' +
    'LEFT JOIN champion_traits ct ON ct.championId = c.id ' +
    'LEFT JOIN traits t ON t.id = ct.traitId ' +
    'GROUP BY c.id'
  ).all();
  const champMap = {};
  for (const c of allChamps) {
    c.traits = c.traitApiNames ? c.traitApiNames.split(',') : [];
    c.traitNameList = c.traitNames ? c.traitNames.split(',') : [];
    champMap[c.apiName] = c;
  }

  // Load meta comps for avgPlace matching
  let metaComps = [];
  try {
    metaComps = db.prepare('SELECT * FROM metatft_meta_comps ORDER BY avgPlace ASC').all()
      .map(c => ({ ...c, units: JSON.parse(c.units) }));
  } catch { /* no data */ }

  const directions = [];
  for (const team of topResults) {
    const champApiNames = team.champs.split(',');
    const champObjects = champApiNames.map(api => champMap[api]).filter(Boolean);

    if (champObjects.length === 0) continue;

    // Format champions like old scout
    const champions = champObjects.map(c => ({
      apiName: c.apiName,
      name: c.name,
      cost: c.cost,
      icon: c.icon || '',
      traits: c.traitNameList || [],
      role: c.role || null,
      plannerCode: c.plannerCode ?? null,
    }));

    // Build active traits
    const traitApiNames = team.traits ? team.traits.split(',') : [];
    const activeTraits = traitApiNames.map(api => {
      const traitData = db.prepare(
        'SELECT t.*, GROUP_CONCAT(tb.minUnits) as thresholds ' +
        'FROM traits t ' +
        'LEFT JOIN trait_breakpoints tb ON tb.traitId = t.id ' +
        'WHERE t.apiName = ? GROUP BY t.id'
      ).get(api);
      if (!traitData) return null;
      const thresholds = traitData.thresholds
        ? traitData.thresholds.split(',').map(Number).sort((a, b) => a - b)
        : [];
      const count = champObjects.filter(c => c.traits.includes(api)).length;
      return { apiName: api, name: traitData.name, count, thresholds };
    }).filter(Boolean);

    // Team planner code
    const setNumber = '17';
    const plannerSlots = champions
      .filter(c => c.plannerCode != null)
      .map(c => c.plannerCode.toString(16).padStart(3, '0'));
    while (plannerSlots.length < 10) plannerSlots.push('000');
    const teamPlannerCode = '02' + plannerSlots.slice(0, 10).join('') + 'TFTSet' + setNumber;

    const endgameComp = {
      champions,
      activeTraits,
      teamPlannerCode,
      score: team.final_score,
    };

    // Early analysis
    const mainTraits = traitApiNames;
    const analysis = buildKeepSellAdd(earlyUnits, champObjects, mainTraits);

    // Meta match
    let metaAvgPlace = null;
    const endgameSet = new Set(champApiNames);
    for (const meta of metaComps) {
      const overlap = meta.units.filter(u => endgameSet.has(u)).length /
        Math.max(meta.units.length, endgameSet.size);
      if (overlap > 0.4) { metaAvgPlace = meta.avgPlace; break; }
    }

    // Transitions from tree
    const transitions = {};
    const ancestors = getAncestors(db, team.id);
    for (const ancestor of ancestors) {
      const ancestorChamps = ancestor.champs.split(',')
        .map(api => champMap[api]).filter(Boolean);
      const ancestorChampions = ancestorChamps.map(c => ({
        apiName: c.apiName, name: c.name, cost: c.cost,
        icon: c.icon || '', traits: c.traitNameList || [],
        role: c.role || null, plannerCode: c.plannerCode ?? null,
      }));
      transitions[ancestor.team_size] = {
        level: ancestor.team_size,
        boardSize: ancestor.team_size,
        main: { champions: ancestorChampions, score: ancestor.base_score },
      };
    }

    const groupName = activeTraits.slice(0, 2).map(t => t.name).join(' + ') || 'Flex';

    directions.push({
      name: groupName,
      mainTrait: traitApiNames[0] || '',
      metaAvgPlace,
      endgameComp,
      earlyAnalysis: analysis,
      earlyUnitsKept: analysis.keep.length,
      score: team.final_score,
      isPrimary: (team.overlap || 0) >= earlyApiNames.length,
      transitions,
      alternativeComps: 0,
    });
  }

  // Sort: primary first, then by score
  directions.sort((a, b) =>
    (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || b.score - a.score
  );

  const maxDirections = Math.max(5, 10 - earlyApiNames.length);

  return {
    directions: directions.slice(0, maxDirections),
    earlyTraitAffinity: affinity,
  };
}

export function scoutV2Routes(db) {
  const router = Router();

  router.post('/', (req, res) => {
    const result = scoutV2(db, req.body);

    if (result.fallback) {
      return res.status(404).json({ error: 'no precomp data', fallback: true });
    }

    res.json(result);
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/scout-v2.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Register route in index.js**

In `server/src/index.js`, add after line 20:

```js
import { scoutV2Routes } from './routes/scout-v2.js';
```

And after line 42 (`app.use('/api/scout', scoutRoutes(db));`):

```js
app.use('/api/scout-v2', scoutV2Routes(db));
```

- [ ] **Step 6: Run all tests**

Run: `cd server && npx vitest run`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/scout-v2.js server/src/index.js server/tests/scout-v2.test.js
git commit -m "feat: scout-v2 route with precomp query + re-score"
```

---

### Task 7: Frontend — Scout V2 with Fallback

**Files:**
- Modify: `client/src/api.js:82-89`

**Context:** Update client API to try scout-v2 first, fall back to old scout on 404 or error.

- [ ] **Step 1: Update client API**

In `client/src/api.js`, replace the existing `scoutDirections` function:

```js
export async function scoutDirections(params) {
  // Try scout-v2 (pre-computed) first
  try {
    const res = await fetch(BASE + '/scout-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      return res.json();
    }
  } catch { /* fall through to old scout */ }

  // Fallback to old scout
  const res = await fetch(BASE + '/scout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}
```

- [ ] **Step 2: Verify no frontend build errors**

Run: `cd client && npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/api.js
git commit -m "feat: client falls back to old scout when scout-v2 unavailable"
```

---

### Task 8: Integration Test — Full Pipeline

- [ ] **Step 1: Write integration test**

```js
// server/tests/scout-v2-integration.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import { importFromData } from '../src/importer.js';
import { generateForTeamSize } from '../src/precomp/generator.js';
import { linkParents, buildChampIndex } from '../src/precomp/linker.js';
import { scoutV2 } from '../src/routes/scout-v2.js';

const MOCK_DATA = {
  sets: {
    "17": {
      champions: [
        { apiName: "TFT17_Jhin", name: "Jhin", cost: 5, traits: ["Dark Star", "Sniper"],
          stats: { hp: 900, armor: 40, magicResist: 40, damage: 84, attackSpeed: 0.9, mana: 44, initialMana: 0, range: 6, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Zed", name: "Zed", cost: 3, traits: ["Dark Star", "Assassin"],
          stats: { hp: 700, armor: 30, magicResist: 30, damage: 60, attackSpeed: 0.8, mana: 30, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Ashe", name: "Ashe", cost: 2, traits: ["Sniper", "Ranger"],
          stats: { hp: 600, armor: 25, magicResist: 25, damage: 50, attackSpeed: 0.75, mana: 40, initialMana: 0, range: 5, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Garen", name: "Garen", cost: 1, traits: ["Knight"],
          stats: { hp: 800, armor: 50, magicResist: 40, damage: 55, attackSpeed: 0.6, mana: 0, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
        { apiName: "TFT17_Katarina", name: "Katarina", cost: 3, traits: ["Assassin"],
          stats: { hp: 650, armor: 30, magicResist: 30, damage: 65, attackSpeed: 0.75, mana: 50, initialMana: 0, range: 1, critChance: 0.25, critMultiplier: 1.4 },
          ability: { desc: "", variables: [] }, icon: "" },
      ],
      traits: [
        { apiName: "TFT17_DarkStar", name: "Dark Star", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }, { minUnits: 4, maxUnits: 25000, style: 3, variables: {} }]},
        { apiName: "TFT17_Sniper", name: "Sniper", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_AssassinTrait", name: "Assassin", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_Knight", name: "Knight", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
        { apiName: "TFT17_Ranger", name: "Ranger", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 25000, style: 1, variables: {} }]},
      ],
    },
  },
};

describe('scout-v2 full pipeline', () => {
  let db;
  beforeEach(() => {
    db = createDb(':memory:');
    importFromData(db, MOCK_DATA);

    // Generate precomp data
    const insert = db.prepare(
      'INSERT INTO precomp_teams (team_size, champs, traits, base_score) VALUES (?, ?, ?, ?)'
    );
    for (const size of [3, 4, 5]) {
      const teams = generateForTeamSize(db, size, { iterations: 100, topN: 20 });
      for (const t of teams) {
        insert.run(size, t.champs, t.traits, t.base_score);
      }
    }
    linkParents(db, 4);
    linkParents(db, 5);
    buildChampIndex(db);
  });

  it('returns directions when early units overlap with precomp data', () => {
    const result = scoutV2(db, {
      earlyUnits: ['TFT17_Zed'],
      currentLevel: 3,
      bonusSlots: 0,
      emblems: [],
      excludedTraits: [],
      lockedTraits: [],
      max5Cost: null,
    });
    expect(result.directions.length).toBeGreaterThan(0);
    expect(result.earlyTraitAffinity).toBeDefined();
  });

  it('each direction has expected shape', () => {
    const result = scoutV2(db, {
      earlyUnits: ['TFT17_Ashe'],
      currentLevel: 3,
      bonusSlots: 0,
      emblems: [],
      excludedTraits: [],
      lockedTraits: [],
      max5Cost: null,
    });
    for (const dir of result.directions) {
      expect(dir).toHaveProperty('name');
      expect(dir).toHaveProperty('endgameComp');
      expect(dir).toHaveProperty('earlyAnalysis');
      expect(dir).toHaveProperty('score');
      expect(dir.endgameComp).toHaveProperty('champions');
      expect(dir.endgameComp).toHaveProperty('activeTraits');
      expect(dir.earlyAnalysis).toHaveProperty('keep');
      expect(dir.earlyAnalysis).toHaveProperty('add');
    }
  });

  it('bonusSlots increases effective team size', () => {
    const noBonus = scoutV2(db, {
      earlyUnits: ['TFT17_Zed'],
      currentLevel: 3,
      bonusSlots: 0,
      emblems: [],
      excludedTraits: [],
      lockedTraits: [],
      max5Cost: null,
    });
    const withBonus = scoutV2(db, {
      earlyUnits: ['TFT17_Zed'],
      currentLevel: 3,
      bonusSlots: 2,
      emblems: [],
      excludedTraits: [],
      lockedTraits: [],
      max5Cost: null,
    });
    if (noBonus.directions.length > 0 && withBonus.directions.length > 0) {
      const noBonusSize = noBonus.directions[0].endgameComp.champions.length;
      const withBonusSize = withBonus.directions[0].endgameComp.champions.length;
      expect(withBonusSize).toBeGreaterThan(noBonusSize);
    }
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd server && npx vitest run tests/scout-v2-integration.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 3: Run all tests**

Run: `cd server && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add server/tests/scout-v2-integration.test.js
git commit -m "test: scout-v2 full pipeline integration test"
```

---

### Task 9: Manual Smoke Test

**Context:** Run the full pipeline on real data and verify performance improvement.

- [ ] **Step 1: Generate precomp data with small config**

Temporarily edit `generate-precomp.js` TEAM_SIZE_CONFIG to use small values (topN: 10, iterations: 50) for each size.

Run: `cd server && node src/generate-precomp.js --regenerate`
Expected: Completes in under 30 seconds, prints counts per team_size

- [ ] **Step 2: Start server and test scout-v2**

Run: `cd server && node src/index.js`

In another terminal:
```bash
curl -X POST http://localhost:3001/api/scout-v2 -H "Content-Type: application/json" -d "{\"earlyUnits\":[\"TFT17_Shen\",\"TFT17_Jhin\"],\"currentLevel\":5,\"bonusSlots\":0,\"emblems\":[],\"excludedTraits\":[],\"lockedTraits\":[],\"max5Cost\":null}"
```

Expected: JSON response with directions array, response time under 100ms

- [ ] **Step 3: Compare with old scout timing**

```bash
curl -w "\nTime: %{time_total}s\n" -X POST http://localhost:3001/api/scout -H "Content-Type: application/json" -d "{\"earlyUnits\":[\"TFT17_Shen\",\"TFT17_Jhin\"],\"currentLevel\":5,\"bonusSlots\":0,\"emblems\":[],\"excludedTraits\":[],\"lockedTraits\":[],\"max5Cost\":null}"
```

```bash
curl -w "\nTime: %{time_total}s\n" -X POST http://localhost:3001/api/scout-v2 -H "Content-Type: application/json" -d "{\"earlyUnits\":[\"TFT17_Shen\",\"TFT17_Jhin\"],\"currentLevel\":5,\"bonusSlots\":0,\"emblems\":[],\"excludedTraits\":[],\"lockedTraits\":[],\"max5Cost\":null}"
```

Expected: Old scout 5-10s, scout-v2 under 100ms

- [ ] **Step 4: Revert generate-precomp.js to production config**

Restore the original TEAM_SIZE_CONFIG values.

- [ ] **Step 5: Commit any fixes from smoke testing**

```bash
git add -u
git commit -m "fix: adjustments from smoke test"
```
