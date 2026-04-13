# TFT Team Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local TFT team composition generator with synergy-based scoring, filters, and AI chat.

**Architecture:** Vite+React frontend talks to Node+Express backend over REST. Backend stores game data in SQLite (imported from Community Dragon), runs a GRASP scoring engine, and proxies AI chat through Ollama (Qwen3 8B). All local, zero cloud.

**Tech Stack:** Vite, React 19, Tailwind CSS 4, Node.js, Express, better-sqlite3, Ollama, Vitest

---

## File Structure

```
tft-generator/
├── package.json                        # Root workspace
├── client/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── App.jsx
│   │   ├── api.js                      # All fetch calls to backend
│   │   └── components/
│   │       ├── FilterPanel.jsx         # Left panel — constraints input
│   │       ├── ChampionPicker.jsx      # Searchable champion dropdown
│   │       ├── TraitPicker.jsx         # Searchable trait dropdown
│   │       ├── ResultsPanel.jsx        # Right panel — team list
│   │       ├── TeamCard.jsx            # Single team result card
│   │       ├── TraitBadge.jsx          # Trait name + breakpoint badge
│   │       └── ChatPanel.jsx           # Bottom panel — AI chat
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── index.js                    # Express entry point
│   │   ├── db.js                       # SQLite connection + schema creation
│   │   ├── importer.js                 # Community Dragon JSON → SQLite
│   │   ├── scoring/
│   │   │   ├── scorer.js               # championScore, traitScore, teamScore
│   │   │   ├── candidates.js           # Filter candidate pool from constraints
│   │   │   └── engine.js               # GRASP: greedy build + local search
│   │   └── routes/
│   │       ├── champions.js            # GET /api/champions
│   │       ├── traits.js               # GET /api/traits
│   │       ├── items.js                # GET /api/items
│   │       ├── generate.js             # POST /api/generate
│   │       ├── chat.js                 # POST /api/chat
│   │       └── import.js               # POST /api/import
│   └── tests/
│       ├── scorer.test.js
│       ├── candidates.test.js
│       ├── engine.test.js
│       └── importer.test.js
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json` (root workspace)
- Create: `server/package.json`
- Create: `server/src/index.js`
- Create: `client/package.json`
- Create: `client/index.html`
- Create: `client/vite.config.js`
- Create: `client/src/main.jsx`
- Create: `client/src/index.css`
- Create: `client/src/App.jsx`

- [ ] **Step 1: Initialize root workspace**

```json
// package.json
{
  "name": "tft-generator",
  "private": true,
  "workspaces": ["client", "server"],
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "npm run dev --workspace=server",
    "dev:client": "npm run dev --workspace=client",
    "import": "npm run import --workspace=server",
    "test": "npm run test --workspace=server"
  },
  "devDependencies": {
    "concurrently": "^9.1.2"
  }
}
```

- [ ] **Step 2: Initialize server package**

```json
// server/package.json
{
  "name": "tft-generator-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "import": "node src/importer.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "cors": "^2.8.5",
    "express": "^5.1.0"
  },
  "devDependencies": {
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 3: Create minimal Express server**

```js
// server/src/index.js
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
```

- [ ] **Step 4: Initialize client with Vite + React + Tailwind**

```json
// client/package.json
{
  "name": "tft-generator-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.4.1",
    "vite": "^6.3.1",
    "tailwindcss": "^4.1.3",
    "@tailwindcss/vite": "^4.1.3"
  }
}
```

```js
// client/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

```html
<!-- client/index.html -->
<!DOCTYPE html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TFT Generator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

```css
/* client/src/index.css */
@import "tailwindcss";
```

```jsx
// client/src/main.jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

```jsx
// client/src/App.jsx
export default function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-2xl font-bold">TFT Generator</h1>
      <p className="text-gray-400 mt-2">Set 17 — Space Gods</p>
    </div>
  );
}
```

- [ ] **Step 5: Install dependencies and verify**

Run:
```bash
npm install
npm run dev:server
```

In another terminal:
```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok"}
npm run dev:client
# Open http://localhost:5173 — should show "TFT Generator" header
```

- [ ] **Step 6: Initialize git and commit**

```bash
cd D:/Projekty/tft-generator
git init
```

Create `.gitignore`:
```
node_modules/
dist/
*.db
.env
```

```bash
git add .
git commit -m "feat: scaffold project — Vite+React client, Express server, workspaces"
```

---

### Task 2: Database Schema

**Files:**
- Create: `server/src/db.js`
- Test: `server/tests/db.test.js`

- [ ] **Step 1: Write failing test for database schema**

```js
// server/tests/db.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';

describe('database schema', () => {
  let db;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates all tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(r => r.name);

    expect(tables).toContain('champions');
    expect(tables).toContain('traits');
    expect(tables).toContain('trait_breakpoints');
    expect(tables).toContain('champion_traits');
    expect(tables).toContain('items');
    expect(tables).toContain('tier_list');
  });

  it('inserts and retrieves a champion', () => {
    db.prepare(`
      INSERT INTO champions (apiName, name, cost, hp, armor, magicResist, attackDamage, attackSpeed, mana, startMana, range, critChance, critMultiplier, icon)
      VALUES ('TFT17_Jhin', 'Jhin', 5, 900, 40, 40, 84, 0.9, 44, 0, 6, 0.25, 1.4, 'icons/jhin.png')
    `).run();

    const champ = db.prepare('SELECT * FROM champions WHERE apiName = ?').get('TFT17_Jhin');
    expect(champ.name).toBe('Jhin');
    expect(champ.cost).toBe(5);
    expect(champ.hp).toBe(900);
  });

  it('enforces unique apiName on champions', () => {
    const insert = db.prepare(`
      INSERT INTO champions (apiName, name, cost, hp, armor, magicResist, attackDamage, attackSpeed, mana, startMana, range, critChance, critMultiplier, icon)
      VALUES ('TFT17_Jhin', 'Jhin', 5, 900, 40, 40, 84, 0.9, 44, 0, 6, 0.25, 1.4, 'icons/jhin.png')
    `);
    insert.run();
    expect(() => insert.run()).toThrow();
  });

  it('links champions to traits via champion_traits', () => {
    db.prepare(`INSERT INTO champions (apiName, name, cost, hp, armor, magicResist, attackDamage, attackSpeed, mana, startMana, range, critChance, critMultiplier, icon) VALUES ('TFT17_Jhin', 'Jhin', 5, 900, 40, 40, 84, 0.9, 44, 0, 6, 0.25, 1.4, '')`).run();
    db.prepare(`INSERT INTO traits (apiName, name, description, icon) VALUES ('TFT17_Sniper', 'Sniper', 'desc', '')`).run();

    const champId = db.prepare('SELECT id FROM champions WHERE apiName = ?').get('TFT17_Jhin').id;
    const traitId = db.prepare('SELECT id FROM traits WHERE apiName = ?').get('TFT17_Sniper').id;

    db.prepare('INSERT INTO champion_traits (championId, traitId) VALUES (?, ?)').run(champId, traitId);

    const linked = db.prepare(`
      SELECT t.name FROM traits t
      JOIN champion_traits ct ON ct.traitId = t.id
      WHERE ct.championId = ?
    `).all(champId);

    expect(linked).toHaveLength(1);
    expect(linked[0].name).toBe('Sniper');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/db.test.js`
Expected: FAIL — cannot find module `../src/db.js`

- [ ] **Step 3: Implement database schema**

```js
// server/src/db.js
import Database from 'better-sqlite3';

export function createDb(path = 'tft.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS champions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apiName TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL,
      hp REAL NOT NULL,
      armor REAL NOT NULL,
      magicResist REAL NOT NULL,
      attackDamage REAL NOT NULL,
      attackSpeed REAL NOT NULL,
      mana REAL NOT NULL,
      startMana REAL NOT NULL,
      range REAL NOT NULL,
      critChance REAL NOT NULL,
      critMultiplier REAL NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      abilityDesc TEXT,
      abilityStats TEXT
    );

    CREATE TABLE IF NOT EXISTS traits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apiName TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS trait_breakpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traitId INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
      minUnits INTEGER NOT NULL,
      maxUnits INTEGER NOT NULL,
      style INTEGER NOT NULL,
      effects TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS champion_traits (
      championId INTEGER NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
      traitId INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
      PRIMARY KEY (championId, traitId)
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apiName TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      component1 TEXT,
      component2 TEXT,
      effects TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      isEmblem INTEGER NOT NULL DEFAULT 0,
      traitId INTEGER REFERENCES traits(id) ON DELETE SET NULL,
      icon TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tier_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      championId INTEGER NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
      tier TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd server && npx vitest run tests/db.test.js`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/db.js server/tests/db.test.js
git commit -m "feat: SQLite schema — champions, traits, items, tier_list"
```

---

### Task 3: Community Dragon Importer

**Files:**
- Create: `server/src/importer.js`
- Test: `server/tests/importer.test.js`

- [ ] **Step 1: Write failing test for importer parsing**

We test the parsing logic with a minimal mock of CDragon JSON structure:

```js
// server/tests/importer.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import { importFromData } from '../src/importer.js';

const MOCK_CDRAGON = {
  sets: {
    "17": {
      champions: [
        {
          apiName: "TFT17_Jhin",
          name: "Jhin",
          cost: 5,
          traits: ["Dark Star", "Sniper"],
          stats: {
            hp: 900, armor: 40, magicResist: 40,
            damage: 84, attackSpeed: 0.9, mana: 44,
            initialMana: 0, range: 6, critChance: 0.25,
            critMultiplier: 1.4
          },
          ability: {
            desc: "Jhin fires shots",
            name: "Space Opera",
            variables: [
              { name: "Damage", value: [0, 100, 150, 250] }
            ]
          },
          icon: "ASSETS/Characters/TFT17_Jhin/icon.png",
          squareIcon: "ASSETS/Characters/TFT17_Jhin/square.png"
        },
        {
          apiName: "TFT17_Zed",
          name: "Zed",
          cost: 3,
          traits: ["Dark Star", "Assassin"],
          stats: {
            hp: 700, armor: 30, magicResist: 30,
            damage: 60, attackSpeed: 0.8, mana: 30,
            initialMana: 0, range: 1, critChance: 0.25,
            critMultiplier: 1.4
          },
          ability: {
            desc: "Zed slashes",
            name: "Shadow Slash",
            variables: []
          },
          icon: "ASSETS/Characters/TFT17_Zed/icon.png",
          squareIcon: "ASSETS/Characters/TFT17_Zed/square.png"
        }
      ],
      traits: [
        {
          apiName: "TFT17_DarkStar",
          name: "Dark Star",
          desc: "Dark Star units gain damage",
          icon: "ASSETS/Traits/DarkStar.png",
          effects: [
            { minUnits: 2, maxUnits: 3, style: 1, variables: { Damage: 0.15 } },
            { minUnits: 4, maxUnits: 5, style: 3, variables: { Damage: 0.30 } },
            { minUnits: 6, maxUnits: 25000, style: 5, variables: { Damage: 0.50 } }
          ]
        },
        {
          apiName: "TFT17_Sniper",
          name: "Sniper",
          desc: "Snipers gain damage per hex",
          icon: "ASSETS/Traits/Sniper.png",
          effects: [
            { minUnits: 2, maxUnits: 3, style: 1, variables: { DamagePerHex: 0.06 } },
            { minUnits: 4, maxUnits: 25000, style: 4, variables: { DamagePerHex: 0.12 } }
          ]
        },
        {
          apiName: "TFT17_Assassin",
          name: "Assassin",
          desc: "Assassins jump to backline",
          icon: "ASSETS/Traits/Assassin.png",
          effects: [
            { minUnits: 2, maxUnits: 3, style: 1, variables: { CritDamage: 0.15 } },
            { minUnits: 4, maxUnits: 25000, style: 4, variables: { CritDamage: 0.30 } }
          ]
        }
      ]
    }
  },
  items: [
    {
      apiName: "TFT_Item_RabadonsDeathcap",
      name: "Rabadon's Deathcap",
      composition: ["TFT_Item_NeedlesslyLargeRod", "TFT_Item_NeedlesslyLargeRod"],
      effects: { AP: 55 },
      desc: "Gain AP",
      icon: "ASSETS/Items/Rabadons.png",
      associatedTraits: [],
      tags: ["AbilityPower"],
      unique: false
    },
    {
      apiName: "TFT17_Item_DarkStarEmblem",
      name: "Dark Star Emblem",
      composition: ["TFT_Item_Spatula", "TFT_Item_BFSword"],
      effects: {},
      desc: "The holder gains Dark Star trait",
      icon: "ASSETS/Items/DarkStarEmblem.png",
      associatedTraits: ["TFT17_DarkStar"],
      tags: ["Emblem"],
      unique: false
    }
  ]
};

describe('importer', () => {
  let db;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('imports champions from CDragon data', () => {
    importFromData(db, MOCK_CDRAGON, "17");

    const champions = db.prepare('SELECT * FROM champions ORDER BY name').all();
    expect(champions).toHaveLength(2);
    expect(champions[0].name).toBe('Jhin');
    expect(champions[0].cost).toBe(5);
    expect(champions[0].hp).toBe(900);
    expect(champions[1].name).toBe('Zed');
  });

  it('imports traits with breakpoints', () => {
    importFromData(db, MOCK_CDRAGON, "17");

    const traits = db.prepare('SELECT * FROM traits ORDER BY name').all();
    expect(traits).toHaveLength(3);

    const darkStar = traits.find(t => t.name === 'Dark Star');
    const breakpoints = db.prepare('SELECT * FROM trait_breakpoints WHERE traitId = ? ORDER BY minUnits').all(darkStar.id);
    expect(breakpoints).toHaveLength(3);
    expect(breakpoints[0].minUnits).toBe(2);
    expect(breakpoints[0].style).toBe(1);
    expect(breakpoints[2].minUnits).toBe(6);
    expect(breakpoints[2].style).toBe(5);
  });

  it('links champions to their traits', () => {
    importFromData(db, MOCK_CDRAGON, "17");

    const jhin = db.prepare('SELECT id FROM champions WHERE apiName = ?').get('TFT17_Jhin');
    const jhinTraits = db.prepare(`
      SELECT t.name FROM traits t
      JOIN champion_traits ct ON ct.traitId = t.id
      WHERE ct.championId = ?
      ORDER BY t.name
    `).all(jhin.id);

    expect(jhinTraits.map(t => t.name)).toEqual(['Dark Star', 'Sniper']);
  });

  it('imports items and identifies emblems', () => {
    importFromData(db, MOCK_CDRAGON, "17");

    const items = db.prepare('SELECT * FROM items ORDER BY name').all();
    expect(items).toHaveLength(2);

    const emblem = items.find(i => i.apiName === 'TFT17_Item_DarkStarEmblem');
    expect(emblem.isEmblem).toBe(1);
    expect(emblem.traitId).not.toBeNull();

    const rabadon = items.find(i => i.apiName === 'TFT_Item_RabadonsDeathcap');
    expect(rabadon.isEmblem).toBe(0);
  });

  it('clears old data on re-import', () => {
    importFromData(db, MOCK_CDRAGON, "17");
    importFromData(db, MOCK_CDRAGON, "17");

    const champions = db.prepare('SELECT * FROM champions').all();
    expect(champions).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/importer.test.js`
Expected: FAIL — cannot find `importFromData`

- [ ] **Step 3: Implement importer**

```js
// server/src/importer.js
import { createDb } from './db.js';

const CDRAGON_URL = 'https://CDRAGON_REDACTED/pbe/cdragon/tft/en_us.json';

export function importFromData(db, data, setNumber = "17") {
  const set = data.sets[setNumber];
  if (!set) throw new Error(`Set ${setNumber} not found in data`);

  const tx = db.transaction(() => {
    // Clear existing data
    db.exec(`
      DELETE FROM champion_traits;
      DELETE FROM trait_breakpoints;
      DELETE FROM champions;
      DELETE FROM traits;
      DELETE FROM items;
    `);

    // Import traits first (champions reference them by name)
    const traitNameToId = {};
    const insertTrait = db.prepare(`
      INSERT INTO traits (apiName, name, description, icon)
      VALUES (@apiName, @name, @description, @icon)
    `);
    const insertBreakpoint = db.prepare(`
      INSERT INTO trait_breakpoints (traitId, minUnits, maxUnits, style, effects)
      VALUES (@traitId, @minUnits, @maxUnits, @style, @effects)
    `);

    for (const trait of set.traits) {
      const result = insertTrait.run({
        apiName: trait.apiName,
        name: trait.name,
        description: trait.desc || '',
        icon: trait.icon || '',
      });
      traitNameToId[trait.name] = result.lastInsertRowid;
      traitNameToId[trait.apiName] = result.lastInsertRowid;

      for (const bp of trait.effects) {
        insertBreakpoint.run({
          traitId: result.lastInsertRowid,
          minUnits: bp.minUnits,
          maxUnits: bp.maxUnits,
          style: bp.style,
          effects: JSON.stringify(bp.variables || {}),
        });
      }
    }

    // Import champions
    const insertChampion = db.prepare(`
      INSERT INTO champions (apiName, name, cost, hp, armor, magicResist, attackDamage, attackSpeed, mana, startMana, range, critChance, critMultiplier, icon, abilityDesc, abilityStats)
      VALUES (@apiName, @name, @cost, @hp, @armor, @magicResist, @attackDamage, @attackSpeed, @mana, @startMana, @range, @critChance, @critMultiplier, @icon, @abilityDesc, @abilityStats)
    `);
    const insertChampionTrait = db.prepare(`
      INSERT INTO champion_traits (championId, traitId) VALUES (?, ?)
    `);

    for (const champ of set.champions) {
      // Skip non-playable units (cost 0 or very high)
      if (champ.cost <= 0 || champ.cost > 10) continue;

      const stats = champ.stats || {};
      const result = insertChampion.run({
        apiName: champ.apiName,
        name: champ.name,
        cost: champ.cost,
        hp: stats.hp || 0,
        armor: stats.armor || 0,
        magicResist: stats.magicResist || 0,
        attackDamage: stats.damage || 0,
        attackSpeed: stats.attackSpeed || 0,
        mana: stats.mana || 0,
        startMana: stats.initialMana || 0,
        range: stats.range || 0,
        critChance: stats.critChance || 0.25,
        critMultiplier: stats.critMultiplier || 1.4,
        icon: champ.squareIcon || champ.icon || '',
        abilityDesc: champ.ability?.desc || '',
        abilityStats: JSON.stringify(champ.ability?.variables || []),
      });

      for (const traitName of (champ.traits || [])) {
        const traitId = traitNameToId[traitName];
        if (traitId) {
          insertChampionTrait.run(result.lastInsertRowid, traitId);
        }
      }
    }

    // Import items
    const insertItem = db.prepare(`
      INSERT INTO items (apiName, name, component1, component2, effects, tags, isEmblem, traitId, icon)
      VALUES (@apiName, @name, @component1, @component2, @effects, @tags, @isEmblem, @traitId, @icon)
    `);

    for (const item of (data.items || [])) {
      const isEmblem = (item.tags || []).includes('Emblem') ||
                       (item.associatedTraits || []).length > 0;
      const traitApiName = (item.associatedTraits || [])[0] || null;
      const traitId = traitApiName ? (traitNameToId[traitApiName] || null) : null;

      insertItem.run({
        apiName: item.apiName,
        name: item.name,
        component1: (item.composition || [])[0] || null,
        component2: (item.composition || [])[1] || null,
        effects: JSON.stringify(item.effects || {}),
        tags: JSON.stringify(item.tags || []),
        isEmblem: isEmblem ? 1 : 0,
        traitId,
        icon: item.icon || '',
      });
    }
  });

  tx();
}

export async function importFromCDragon(db, setNumber = "17") {
  console.log('Fetching data from Community Dragon...');
  const res = await fetch(CDRAGON_URL);
  if (!res.ok) throw new Error('CDragon fetch failed: ' + res.status);
  const data = await res.json();
  console.log('Importing Set ' + setNumber + ' data...');
  importFromData(db, data, setNumber);
  const champCount = db.prepare('SELECT COUNT(*) as c FROM champions').get().c;
  const traitCount = db.prepare('SELECT COUNT(*) as c FROM traits').get().c;
  const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
  console.log('Done: ' + champCount + ' champions, ' + traitCount + ' traits, ' + itemCount + ' items');
  return { champCount, traitCount, itemCount };
}

// CLI entry point
const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('src/importer.js');
if (isDirectRun) {
  const db = createDb('tft.db');
  importFromCDragon(db).catch(console.error);
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd server && npx vitest run tests/importer.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Test real import from Community Dragon**

Run: `cd server && node src/importer.js`
Expected: Output like `Done: 60 champions, 44 traits, 400+ items`

- [ ] **Step 6: Commit**

```bash
git add server/src/importer.js server/tests/importer.test.js
git commit -m "feat: Community Dragon importer — fetch + parse + upsert to SQLite"
```

---

### Task 4: API Routes — Champions, Traits, Items

**Files:**
- Create: `server/src/routes/champions.js`
- Create: `server/src/routes/traits.js`
- Create: `server/src/routes/items.js`
- Create: `server/src/routes/import.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Implement champion routes**

```js
// server/src/routes/champions.js
import { Router } from 'express';

export function championRoutes(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const { cost, trait } = req.query;
    let sql = `
      SELECT c.*, GROUP_CONCAT(t.name, ', ') as traitNames,
             GROUP_CONCAT(t.apiName, ',') as traitApiNames
      FROM champions c
      LEFT JOIN champion_traits ct ON ct.championId = c.id
      LEFT JOIN traits t ON t.id = ct.traitId
    `;
    const conditions = [];
    const params = [];

    if (cost) {
      conditions.push('c.cost = ?');
      params.push(Number(cost));
    }
    if (trait) {
      conditions.push('(t.apiName = ? OR t.name = ?)');
      params.push(trait, trait);
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' GROUP BY c.id ORDER BY c.cost, c.name';

    res.json(db.prepare(sql).all(...params));
  });

  return router;
}
```

- [ ] **Step 2: Implement trait routes**

```js
// server/src/routes/traits.js
import { Router } from 'express';

export function traitRoutes(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const traits = db.prepare('SELECT * FROM traits ORDER BY name').all();

    for (const trait of traits) {
      trait.breakpoints = db.prepare(
        'SELECT * FROM trait_breakpoints WHERE traitId = ? ORDER BY minUnits'
      ).all(trait.id);
    }

    res.json(traits);
  });

  return router;
}
```

- [ ] **Step 3: Implement item routes**

```js
// server/src/routes/items.js
import { Router } from 'express';

export function itemRoutes(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const { emblems } = req.query;
    let sql = `
      SELECT i.*, t.name as traitName, t.apiName as traitApiName
      FROM items i
      LEFT JOIN traits t ON t.id = i.traitId
    `;
    if (emblems === 'true') sql += ' WHERE i.isEmblem = 1';
    sql += ' ORDER BY i.name';

    res.json(db.prepare(sql).all());
  });

  return router;
}
```

- [ ] **Step 4: Implement import route**

```js
// server/src/routes/import.js
import { Router } from 'express';
import { importFromCDragon } from '../importer.js';

export function importRoutes(db) {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const result = await importFromCDragon(db);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 5: Wire routes into Express server**

```js
// server/src/index.js
import express from 'express';
import cors from 'cors';
import { createDb } from './db.js';
import { championRoutes } from './routes/champions.js';
import { traitRoutes } from './routes/traits.js';
import { itemRoutes } from './routes/items.js';
import { importRoutes } from './routes/import.js';

const db = createDb('tft.db');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/champions', championRoutes(db));
app.use('/api/traits', traitRoutes(db));
app.use('/api/items', itemRoutes(db));
app.use('/api/import', importRoutes(db));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});

export { app, db };
```

- [ ] **Step 6: Verify with curl**

Run (import data first, then start server):
```bash
cd server && node src/importer.js
node src/index.js &
curl http://localhost:3001/api/champions | head -c 500
curl http://localhost:3001/api/traits | head -c 500
curl "http://localhost:3001/api/items?emblems=true" | head -c 500
```

Expected: JSON arrays with champion/trait/item data.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/ server/src/index.js
git commit -m "feat: REST API routes — champions, traits, items, import"
```

---

### Task 5: Scoring — Score Functions

**Files:**
- Create: `server/src/scoring/scorer.js`
- Test: `server/tests/scorer.test.js`

- [ ] **Step 1: Write failing tests for scoring functions**

```js
// server/tests/scorer.test.js
import { describe, it, expect } from 'vitest';
import { championScore, traitScore, emblemBonus, teamScore } from '../src/scoring/scorer.js';

describe('championScore', () => {
  it('calculates score from tier + cost', () => {
    expect(championScore({ cost: 5 }, 'S')).toBe(10 + 10); // tierWeight + cost*2
    expect(championScore({ cost: 1 }, 'D')).toBe(2 + 2);
    expect(championScore({ cost: 3 }, null)).toBe(0 + 6); // no tier = 0 tierWeight
  });
});

describe('traitScore', () => {
  const breakpoints = [
    { minUnits: 2, maxUnits: 3, style: 1 },
    { minUnits: 4, maxUnits: 5, style: 3 },
    { minUnits: 6, maxUnits: 25000, style: 5 },
  ];

  it('returns 0 when trait not active', () => {
    expect(traitScore(1, breakpoints)).toBe(0);
  });

  it('scores bronze breakpoint', () => {
    expect(traitScore(2, breakpoints)).toBe(1); // style=1 * (1 + 0.5*0)
  });

  it('scores gold breakpoint', () => {
    expect(traitScore(4, breakpoints)).toBe(3); // style=3 * (1 + 0.5*0)
  });

  it('adds overflow bonus', () => {
    // 5 units, gold breakpoint (min=4), overflow=1
    expect(traitScore(5, breakpoints)).toBe(3 * (1 + 0.5 * 1)); // 4.5
  });

  it('returns nearBreakpoint info', () => {
    const result = traitScore(3, breakpoints, { includeNear: true });
    expect(result.near).toEqual({ current: 3, next: 4, missing: 1 });
  });
});

describe('emblemBonus', () => {
  const breakpoints = [
    { minUnits: 2, maxUnits: 3, style: 1 },
    { minUnits: 4, maxUnits: 5, style: 3 },
  ];

  it('gives big bonus when emblem unlocks higher breakpoint', () => {
    // 3 units without emblem (bronze), 4 with emblem (silver) → diff=2 → 2*3=6
    expect(emblemBonus(3, breakpoints)).toBe((3 - 1) * 3);
  });

  it('gives minimal bonus when emblem does not change breakpoint', () => {
    // 2 units without emblem (bronze), 3 with emblem (still bronze)
    expect(emblemBonus(2, breakpoints)).toBe(1);
  });
});

describe('teamScore', () => {
  it('sums champion scores + trait scores + emblem bonuses', () => {
    const team = {
      champions: [
        { cost: 5, apiName: 'a' },
        { cost: 3, apiName: 'b' },
      ],
      activeTraits: [
        { count: 4, breakpoints: [
          { minUnits: 2, maxUnits: 3, style: 1 },
          { minUnits: 4, maxUnits: 25000, style: 3 },
        ]},
      ],
      emblemBonuses: [],
      tierMap: { a: 'S', b: 'A' },
    };

    const score = teamScore(team);
    const expectedChampions = (10 + 10) + (8 + 6); // 34
    const expectedTraits = 3; // style=3, no overflow
    expect(score).toBe(expectedChampions + expectedTraits);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/scorer.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement scoring functions**

```js
// server/src/scoring/scorer.js
const TIER_WEIGHTS = { S: 10, A: 8, B: 6, C: 4, D: 2 };

export function championScore(champion, tier) {
  const tierWeight = TIER_WEIGHTS[tier] || 0;
  const costWeight = champion.cost * 2;
  return tierWeight + costWeight;
}

export function traitScore(unitCount, breakpoints, options = {}) {
  if (!breakpoints || breakpoints.length === 0) return options.includeNear ? { score: 0 } : 0;

  // Find highest active breakpoint
  let activeBreakpoint = null;
  let nextBreakpoint = null;

  const sorted = [...breakpoints].sort((a, b) => a.minUnits - b.minUnits);

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (unitCount >= sorted[i].minUnits) {
      activeBreakpoint = sorted[i];
      nextBreakpoint = sorted[i + 1] || null;
      break;
    }
  }

  // Find nearest unreached breakpoint for "near" info
  let nearInfo = null;
  if (!activeBreakpoint) {
    // Not active at all — check if close to first breakpoint
    if (unitCount === sorted[0].minUnits - 1) {
      nearInfo = { current: unitCount, next: sorted[0].minUnits, missing: 1 };
    }
  } else if (nextBreakpoint) {
    const missing = nextBreakpoint.minUnits - unitCount;
    if (missing === 1) {
      nearInfo = { current: unitCount, next: nextBreakpoint.minUnits, missing: 1 };
    }
  }

  if (!activeBreakpoint) {
    return options.includeNear ? { score: 0, near: nearInfo } : 0;
  }

  const overflow = unitCount - activeBreakpoint.minUnits;
  const score = activeBreakpoint.style * (1 + 0.5 * overflow);

  if (options.includeNear) {
    return { score, near: nearInfo };
  }
  return score;
}

export function emblemBonus(currentUnitsWithoutEmblem, breakpoints) {
  if (!breakpoints || breakpoints.length === 0) return 1;

  const sorted = [...breakpoints].sort((a, b) => a.minUnits - b.minUnits);
  const withoutCount = currentUnitsWithoutEmblem;
  const withCount = currentUnitsWithoutEmblem + 1;

  let styleBefore = 0;
  let styleAfter = 0;

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (withoutCount >= sorted[i].minUnits && styleBefore === 0) {
      styleBefore = sorted[i].style;
    }
    if (withCount >= sorted[i].minUnits && styleAfter === 0) {
      styleAfter = sorted[i].style;
    }
  }

  if (styleAfter > styleBefore) {
    return (styleAfter - styleBefore) * 3;
  }
  return 1;
}

export function teamScore(team) {
  let score = 0;

  for (const champ of team.champions) {
    score += championScore(champ, team.tierMap?.[champ.apiName] || null);
  }

  for (const trait of team.activeTraits) {
    score += traitScore(trait.count, trait.breakpoints);
  }

  for (const eb of (team.emblemBonuses || [])) {
    score += emblemBonus(eb.unitsWithoutEmblem, eb.breakpoints);
  }

  return score;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd server && npx vitest run tests/scorer.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/scoring/scorer.js server/tests/scorer.test.js
git commit -m "feat: scoring functions — champion, trait, emblem, team score"
```

---

### Task 6: Scoring — Candidate Filtering

**Files:**
- Create: `server/src/scoring/candidates.js`
- Test: `server/tests/candidates.test.js`

- [ ] **Step 1: Write failing test for candidate filtering**

```js
// server/tests/candidates.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import { importFromData } from '../src/importer.js';
import { filterCandidates } from '../src/scoring/candidates.js';

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
      ],
      traits: [
        { apiName: "TFT17_DarkStar", name: "Dark Star", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }] },
        { apiName: "TFT17_Sniper", name: "Sniper", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }] },
        { apiName: "TFT17_Assassin", name: "Assassin", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }] },
        { apiName: "TFT17_Ranger", name: "Ranger", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }] },
        { apiName: "TFT17_Knight", name: "Knight", desc: "", icon: "",
          effects: [{ minUnits: 2, maxUnits: 3, style: 1, variables: {} }] },
      ]
    }
  },
  items: []
};

describe('filterCandidates', () => {
  let db;

  beforeEach(() => {
    db = createDb(':memory:');
    importFromData(db, MOCK_DATA, "17");
  });

  it('excludes specified champions', () => {
    const result = filterCandidates(db, {
      lockedChampions: [],
      lockedTraits: [],
      emblems: [],
      excludedChampions: ['TFT17_Garen'],
      level: 8,
    });
    expect(result.find(c => c.apiName === 'TFT17_Garen')).toBeUndefined();
  });

  it('prioritizes champions sharing traits with locked champions', () => {
    const result = filterCandidates(db, {
      lockedChampions: ['TFT17_Jhin'],
      lockedTraits: [],
      emblems: [],
      excludedChampions: [],
      level: 8,
    });
    // Zed (Dark Star) and Ashe (Sniper) share traits with Jhin
    const names = result.map(c => c.apiName);
    expect(names).toContain('TFT17_Zed');
    expect(names).toContain('TFT17_Ashe');
  });

  it('includes all non-excluded champions (does not over-prune)', () => {
    const result = filterCandidates(db, {
      lockedChampions: ['TFT17_Jhin'],
      lockedTraits: [],
      emblems: [],
      excludedChampions: [],
      level: 8,
    });
    // Garen (Knight) has no overlap but should still be included
    expect(result.find(c => c.apiName === 'TFT17_Garen')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/candidates.test.js`
Expected: FAIL

- [ ] **Step 3: Implement candidate filtering**

```js
// server/src/scoring/candidates.js
export function filterCandidates(db, constraints) {
  const { lockedChampions = [], lockedTraits = [], emblems = [], excludedChampions = [] } = constraints;

  // Get all champions with their traits
  const allChampions = db.prepare(`
    SELECT c.*, GROUP_CONCAT(t.apiName) as traitApiNames, GROUP_CONCAT(t.name) as traitNames
    FROM champions c
    LEFT JOIN champion_traits ct ON ct.championId = c.id
    LEFT JOIN traits t ON t.id = ct.traitId
    GROUP BY c.id
  `).all();

  // Parse trait strings into arrays
  for (const champ of allChampions) {
    champ.traits = champ.traitApiNames ? champ.traitApiNames.split(',') : [];
    champ.traitNameList = champ.traitNames ? champ.traitNames.split(',') : [];
  }

  // Collect relevant trait apiNames from locked champions + locked traits + emblems
  const relevantTraits = new Set(lockedTraits);
  for (const champ of allChampions) {
    if (lockedChampions.includes(champ.apiName)) {
      champ.traits.forEach(t => relevantTraits.add(t));
    }
  }
  // Add emblem traits
  for (const emblemTrait of emblems) {
    relevantTraits.add(emblemTrait);
  }

  // Filter: exclude specified champions, exclude locked ones (they're already in team)
  const lockedSet = new Set(lockedChampions);
  const excludedSet = new Set(excludedChampions);

  const candidates = allChampions
    .filter(c => !excludedSet.has(c.apiName))
    .filter(c => !lockedSet.has(c.apiName))
    .map(c => {
      // Score relevance: how many traits overlap with desired ones
      const overlap = c.traits.filter(t => relevantTraits.has(t)).length;
      return { ...c, relevance: overlap };
    })
    .sort((a, b) => b.relevance - a.relevance);

  return candidates;
}

export function getLockedChampions(db, apiNames) {
  if (!apiNames.length) return [];
  const placeholders = apiNames.map(() => '?').join(',');
  const champions = db.prepare(`
    SELECT c.*, GROUP_CONCAT(t.apiName) as traitApiNames, GROUP_CONCAT(t.name) as traitNames
    FROM champions c
    LEFT JOIN champion_traits ct ON ct.championId = c.id
    LEFT JOIN traits t ON t.id = ct.traitId
    WHERE c.apiName IN (${placeholders})
    GROUP BY c.id
  `).all(...apiNames);

  for (const champ of champions) {
    champ.traits = champ.traitApiNames ? champ.traitApiNames.split(',') : [];
    champ.traitNameList = champ.traitNames ? champ.traitNames.split(',') : [];
  }
  return champions;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd server && npx vitest run tests/candidates.test.js`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/scoring/candidates.js server/tests/candidates.test.js
git commit -m "feat: candidate filtering — exclude, prioritize by trait overlap"
```

---

### Task 7: Scoring — GRASP Engine

**Files:**
- Create: `server/src/scoring/engine.js`
- Test: `server/tests/engine.test.js`

- [ ] **Step 1: Write failing tests for GRASP engine**

```js
// server/tests/engine.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import { importFromData } from '../src/importer.js';
import { generateTeams } from '../src/scoring/engine.js';

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
          effects: [
            { minUnits: 2, maxUnits: 3, style: 1, variables: {} },
            { minUnits: 4, maxUnits: 25000, style: 3, variables: {} },
          ]},
        { apiName: "TFT17_Sniper", name: "Sniper", desc: "", icon: "",
          effects: [
            { minUnits: 2, maxUnits: 25000, style: 1, variables: {} },
          ]},
        { apiName: "TFT17_Assassin", name: "Assassin", desc: "", icon: "",
          effects: [
            { minUnits: 2, maxUnits: 25000, style: 1, variables: {} },
          ]},
        { apiName: "TFT17_Ranger", name: "Ranger", desc: "", icon: "",
          effects: [
            { minUnits: 2, maxUnits: 25000, style: 1, variables: {} },
          ]},
        { apiName: "TFT17_Knight", name: "Knight", desc: "", icon: "",
          effects: [
            { minUnits: 2, maxUnits: 25000, style: 1, variables: {} },
          ]},
      ]
    }
  },
  items: []
};

describe('generateTeams', () => {
  let db;

  beforeEach(() => {
    db = createDb(':memory:');
    importFromData(db, MOCK_DATA, "17");
  });

  it('generates teams respecting locked champions', () => {
    const results = generateTeams(db, {
      lockedChampions: ['TFT17_Jhin'],
      lockedTraits: [],
      emblems: [],
      excludedChampions: [],
      level: 4,
    });

    expect(results.length).toBeGreaterThan(0);
    for (const team of results) {
      expect(team.champions.find(c => c.apiName === 'TFT17_Jhin')).toBeDefined();
      expect(team.champions.length).toBeLessThanOrEqual(4);
    }
  });

  it('excludes specified champions from all teams', () => {
    const results = generateTeams(db, {
      lockedChampions: [],
      lockedTraits: [],
      emblems: [],
      excludedChampions: ['TFT17_Garen'],
      level: 4,
    });

    for (const team of results) {
      expect(team.champions.find(c => c.apiName === 'TFT17_Garen')).toBeUndefined();
    }
  });

  it('returns teams sorted by score descending', () => {
    const results = generateTeams(db, {
      lockedChampions: [],
      lockedTraits: [],
      emblems: [],
      excludedChampions: [],
      level: 4,
    });

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns teams with active traits info', () => {
    const results = generateTeams(db, {
      lockedChampions: ['TFT17_Jhin', 'TFT17_Zed'],
      lockedTraits: [],
      emblems: [],
      excludedChampions: [],
      level: 4,
    });

    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    expect(first.activeTraits).toBeDefined();
    expect(Array.isArray(first.activeTraits)).toBe(true);
    // Jhin+Zed should have Dark Star active (2 units)
    const darkStar = first.activeTraits.find(t => t.name === 'Dark Star');
    expect(darkStar).toBeDefined();
    expect(darkStar.count).toBeGreaterThanOrEqual(2);
  });

  it('returns no more than topN teams', () => {
    const results = generateTeams(db, {
      lockedChampions: [],
      lockedTraits: [],
      emblems: [],
      excludedChampions: [],
      level: 3,
    }, { topN: 3, iterations: 100 });

    expect(results.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/engine.test.js`
Expected: FAIL

- [ ] **Step 3: Implement GRASP engine**

```js
// server/src/scoring/engine.js
import { filterCandidates, getLockedChampions } from './candidates.js';
import { championScore, traitScore, teamScore } from './scorer.js';

export function generateTeams(db, constraints, options = {}) {
  const { topN = 10, iterations = 500 } = options;
  const { lockedChampions = [], emblems = [], level = 8 } = constraints;

  // Load trait breakpoints for scoring
  const allTraits = db.prepare('SELECT * FROM traits').all();
  const traitBreakpointsMap = {};
  for (const trait of allTraits) {
    traitBreakpointsMap[trait.apiName] = {
      ...trait,
      breakpoints: db.prepare(
        'SELECT * FROM trait_breakpoints WHERE traitId = ? ORDER BY minUnits'
      ).all(trait.id),
    };
    traitBreakpointsMap[trait.name] = traitBreakpointsMap[trait.apiName];
  }

  // Load tier list
  const tierRows = db.prepare(`
    SELECT c.apiName, tl.tier FROM tier_list tl
    JOIN champions c ON c.id = tl.championId
  `).all();
  const tierMap = {};
  for (const row of tierRows) {
    tierMap[row.apiName] = row.tier;
  }

  // Get locked champions and candidates
  const locked = getLockedChampions(db, lockedChampions);
  const candidates = filterCandidates(db, constraints);
  const slotsToFill = level - locked.length;

  if (slotsToFill <= 0) {
    // Already full team, just score it
    const team = buildTeamResult(locked, emblems, traitBreakpointsMap, tierMap);
    return [team];
  }

  // GRASP: generate many teams, keep best unique ones
  const teamSet = new Map();

  for (let i = 0; i < iterations; i++) {
    const team = greedyBuild(locked, candidates, slotsToFill, traitBreakpointsMap, tierMap, emblems);
    const improved = localSearch(team, candidates, traitBreakpointsMap, tierMap, emblems, locked);
    const key = improved.map(c => c.apiName).sort().join(',');

    if (!teamSet.has(key)) {
      const result = buildTeamResult(improved, emblems, traitBreakpointsMap, tierMap);
      teamSet.set(key, result);
    }
  }

  return [...teamSet.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function greedyBuild(locked, candidates, slotsToFill, traitBreakpointsMap, tierMap, emblems) {
  const team = [...locked];
  const usedApiNames = new Set(team.map(c => c.apiName));

  for (let s = 0; s < slotsToFill; s++) {
    let bestCandidates = [];

    for (const candidate of candidates) {
      if (usedApiNames.has(candidate.apiName)) continue;

      const testTeam = [...team, candidate];
      const score = quickScore(testTeam, traitBreakpointsMap, tierMap, emblems);
      bestCandidates.push({ candidate, score });
    }

    bestCandidates.sort((a, b) => b.score - a.score);

    if (bestCandidates.length === 0) break;

    // GRASP randomization: 80% pick best, 20% pick 2nd or 3rd
    let pick;
    const rand = Math.random();
    if (rand < 0.8 || bestCandidates.length === 1) {
      pick = bestCandidates[0];
    } else if (bestCandidates.length === 2) {
      pick = bestCandidates[1];
    } else {
      pick = bestCandidates[Math.random() < 0.5 ? 1 : 2];
    }

    team.push(pick.candidate);
    usedApiNames.add(pick.candidate.apiName);
  }

  return team;
}

function localSearch(team, candidates, traitBreakpointsMap, tierMap, emblems, locked) {
  const lockedSet = new Set(locked.map(c => c.apiName));
  let improved = [...team];
  let currentScore = quickScore(improved, traitBreakpointsMap, tierMap, emblems);
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < improved.length; i++) {
      if (lockedSet.has(improved[i].apiName)) continue;

      for (const candidate of candidates) {
        if (improved.find(c => c.apiName === candidate.apiName)) continue;

        const testTeam = [...improved];
        testTeam[i] = candidate;
        const newScore = quickScore(testTeam, traitBreakpointsMap, tierMap, emblems);

        if (newScore > currentScore) {
          improved[i] = candidate;
          currentScore = newScore;
          changed = true;
        }
      }
    }
  }

  return improved;
}

function quickScore(teamChampions, traitBreakpointsMap, tierMap, emblems) {
  // Count traits across team
  const traitCounts = {};
  for (const champ of teamChampions) {
    for (const traitApiName of (champ.traits || [])) {
      traitCounts[traitApiName] = (traitCounts[traitApiName] || 0) + 1;
    }
  }

  // Add emblem contributions
  for (const emblemTrait of emblems) {
    traitCounts[emblemTrait] = (traitCounts[emblemTrait] || 0) + 1;
  }

  // Build team object for scoring
  const activeTraits = [];
  for (const [traitApiName, count] of Object.entries(traitCounts)) {
    const traitData = traitBreakpointsMap[traitApiName];
    if (traitData) {
      activeTraits.push({ count, breakpoints: traitData.breakpoints });
    }
  }

  return teamScore({
    champions: teamChampions,
    activeTraits,
    emblemBonuses: [],
    tierMap,
  });
}

function buildTeamResult(teamChampions, emblems, traitBreakpointsMap, tierMap) {
  const traitCounts = {};
  for (const champ of teamChampions) {
    for (const traitApiName of (champ.traits || [])) {
      traitCounts[traitApiName] = (traitCounts[traitApiName] || 0) + 1;
    }
  }
  for (const emblemTrait of emblems) {
    traitCounts[emblemTrait] = (traitCounts[emblemTrait] || 0) + 1;
  }

  const activeTraits = [];
  for (const [traitApiName, count] of Object.entries(traitCounts)) {
    const traitData = traitBreakpointsMap[traitApiName];
    if (!traitData) continue;

    const bp = traitData.breakpoints || [];
    const sorted = [...bp].sort((a, b) => a.minUnits - b.minUnits);
    let activeStyle = 0;
    let nextBp = null;

    for (let i = sorted.length - 1; i >= 0; i--) {
      if (count >= sorted[i].minUnits) {
        activeStyle = sorted[i].style;
        nextBp = sorted[i + 1] || null;
        break;
      }
    }

    if (activeStyle > 0) {
      const result = {
        apiName: traitApiName,
        name: traitData.name,
        count,
        style: activeStyle,
        breakpoints: sorted,
      };

      if (nextBp && nextBp.minUnits - count === 1) {
        result.nearNext = { current: count, next: nextBp.minUnits, missing: 1 };
      }

      activeTraits.push(result);
    }
  }

  const score = teamScore({
    champions: teamChampions,
    activeTraits: activeTraits.map(t => ({ count: t.count, breakpoints: t.breakpoints })),
    emblemBonuses: [],
    tierMap,
  });

  return {
    champions: teamChampions.map(c => ({
      apiName: c.apiName,
      name: c.name,
      cost: c.cost,
      icon: c.icon || c.squareIcon || '',
      traits: c.traitNameList || c.traits || [],
    })),
    activeTraits: activeTraits.map(t => ({
      apiName: t.apiName,
      name: t.name,
      count: t.count,
      style: t.style,
      nearNext: t.nearNext || null,
    })),
    score,
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd server && npx vitest run tests/engine.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/scoring/engine.js server/tests/engine.test.js
git commit -m "feat: GRASP team generator — greedy build + local search + dedup"
```

---

### Task 8: Generate API Route

**Files:**
- Create: `server/src/routes/generate.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Implement generate route**

```js
// server/src/routes/generate.js
import { Router } from 'express';
import { generateTeams } from '../scoring/engine.js';

export function generateRoutes(db) {
  const router = Router();

  router.post('/', (req, res) => {
    const {
      lockedChampions = [],
      lockedTraits = [],
      emblems = [],
      excludedChampions = [],
      level = 8,
      topN = 10,
      iterations = 500,
    } = req.body;

    const results = generateTeams(db, {
      lockedChampions,
      lockedTraits,
      emblems,
      excludedChampions,
      level,
    }, { topN, iterations });

    res.json(results);
  });

  return router;
}
```

- [ ] **Step 2: Add route to server**

In `server/src/index.js`, add the import at the top:

```js
import { generateRoutes } from './routes/generate.js';
```

And add this line after the other `app.use` lines:

```js
app.use('/api/generate', generateRoutes(db));
```

Full updated `server/src/index.js`:

```js
import express from 'express';
import cors from 'cors';
import { createDb } from './db.js';
import { championRoutes } from './routes/champions.js';
import { traitRoutes } from './routes/traits.js';
import { itemRoutes } from './routes/items.js';
import { importRoutes } from './routes/import.js';
import { generateRoutes } from './routes/generate.js';

const db = createDb('tft.db');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/champions', championRoutes(db));
app.use('/api/traits', traitRoutes(db));
app.use('/api/items', itemRoutes(db));
app.use('/api/import', importRoutes(db));
app.use('/api/generate', generateRoutes(db));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});

export { app, db };
```

- [ ] **Step 3: Test with curl**

Run (assuming data imported and server running):
```bash
curl -X POST http://localhost:3001/api/generate \
  -H "Content-Type: application/json" \
  -d '{"lockedChampions":["TFT17_Jhin"],"level":8}'
```

Expected: JSON array of team objects with champions, activeTraits, score.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/generate.js server/src/index.js
git commit -m "feat: POST /api/generate — team generation endpoint"
```

---

### Task 9: Frontend — App Shell + API Layer

**Files:**
- Create: `client/src/api.js`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create API helper**

```js
// client/src/api.js
const BASE = '/api';

export async function fetchChampions() {
  const res = await fetch(BASE + '/champions');
  return res.json();
}

export async function fetchTraits() {
  const res = await fetch(BASE + '/traits');
  return res.json();
}

export async function fetchItems({ emblems = false } = {}) {
  const params = emblems ? '?emblems=true' : '';
  const res = await fetch(BASE + '/items' + params);
  return res.json();
}

export async function generateTeams(constraints) {
  const res = await fetch(BASE + '/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(constraints),
  });
  return res.json();
}

export async function sendChat(message) {
  const res = await fetch(BASE + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return res.json();
}

export async function importData() {
  const res = await fetch(BASE + '/import', { method: 'POST' });
  return res.json();
}
```

- [ ] **Step 2: Create App shell with 3-panel layout**

```jsx
// client/src/App.jsx
import { useState, useEffect } from 'react';
import { fetchChampions, fetchTraits, fetchItems } from './api';
import FilterPanel from './components/FilterPanel';
import ResultsPanel from './components/ResultsPanel';
import ChatPanel from './components/ChatPanel';

export default function App() {
  const [champions, setChampions] = useState([]);
  const [traits, setTraits] = useState([]);
  const [emblems, setEmblems] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([fetchChampions(), fetchTraits(), fetchItems({ emblems: true })])
      .then(([c, t, e]) => {
        setChampions(c);
        setTraits(t);
        setEmblems(e);
      })
      .catch(console.error);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">TFT Generator</h1>
          <p className="text-sm text-gray-400">Set 17 — Space Gods</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 border-r border-gray-700 p-4 overflow-y-auto">
          <FilterPanel
            champions={champions}
            traits={traits}
            emblems={emblems}
            onResults={setResults}
            onLoading={setLoading}
          />
        </aside>
        <main className="flex-1 p-4 overflow-y-auto">
          <ResultsPanel results={results} loading={loading} />
        </main>
      </div>

      <ChatPanel onResults={setResults} />
    </div>
  );
}
```

- [ ] **Step 3: Create placeholder components**

```jsx
// client/src/components/FilterPanel.jsx
export default function FilterPanel({ champions, traits, emblems, onResults, onLoading }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Filtry</h2>
      <p className="text-gray-500 text-sm">
        {champions.length} championow, {traits.length} traitow
      </p>
    </div>
  );
}
```

```jsx
// client/src/components/ResultsPanel.jsx
export default function ResultsPanel({ results, loading }) {
  if (loading) return <p className="text-gray-400">Generuje teamy...</p>;
  if (!results.length) return <p className="text-gray-500">Ustaw filtry i kliknij Generuj</p>;
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Wyniki ({results.length})</h2>
      {results.map((team, i) => (
        <div key={i} className="bg-gray-800 rounded p-3 mb-2">
          <p>Team {i + 1} — Score: {team.score}</p>
          <p className="text-sm text-gray-400">
            {team.champions.map(c => c.name).join(', ')}
          </p>
        </div>
      ))}
    </div>
  );
}
```

```jsx
// client/src/components/ChatPanel.jsx
export default function ChatPanel({ onResults }) {
  return (
    <div className="border-t border-gray-700 p-3">
      <p className="text-gray-500 text-sm">AI Chat — wkrotce</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify frontend renders and loads data**

Run: `npm run dev`
Open `http://localhost:5173`. Expected: Header + filter panel showing champion/trait count + empty results.

- [ ] **Step 5: Commit**

```bash
git add client/src/
git commit -m "feat: app shell — 3-panel layout, API layer, placeholder components"
```

---

### Task 10: Frontend — Filter Panel

**Files:**
- Create: `client/src/components/ChampionPicker.jsx`
- Create: `client/src/components/TraitPicker.jsx`
- Modify: `client/src/components/FilterPanel.jsx`

- [ ] **Step 1: Create ChampionPicker — searchable dropdown**

```jsx
// client/src/components/ChampionPicker.jsx
import { useState, useRef, useEffect } from 'react';

const COST_COLORS = {
  1: 'border-gray-500',
  2: 'border-green-500',
  3: 'border-blue-500',
  4: 'border-purple-500',
  5: 'border-yellow-500',
};

export default function ChampionPicker({ champions, selected, onChange, label, exclude = [] }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const excludeSet = new Set([...exclude, ...selected]);
  const filtered = champions
    .filter(c => !excludeSet.has(c.apiName))
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const remove = (apiName) => onChange(selected.filter(s => s !== apiName));
  const add = (apiName) => {
    onChange([...selected, apiName]);
    setSearch('');
    setOpen(false);
  };

  const selectedChamps = selected.map(s => champions.find(c => c.apiName === s)).filter(Boolean);

  return (
    <div ref={ref} className="mb-3 relative">
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {selectedChamps.map(c => (
          <span key={c.apiName}
            className={'text-xs px-2 py-1 rounded border bg-gray-800 cursor-pointer hover:bg-red-900 ' + (COST_COLORS[c.cost] || 'border-gray-600')}
            onClick={() => remove(c.apiName)}>
            {c.name} x
          </span>
        ))}
      </div>
      <input
        type="text"
        placeholder="Szukaj..."
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-gray-800 border border-gray-600 rounded shadow-lg">
          {filtered.slice(0, 20).map(c => (
            <div key={c.apiName}
              className="px-2 py-1 text-sm hover:bg-gray-700 cursor-pointer flex justify-between"
              onClick={() => add(c.apiName)}>
              <span>{c.name}</span>
              <span className="text-gray-500">{c.cost}g</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create TraitPicker — similar searchable dropdown**

```jsx
// client/src/components/TraitPicker.jsx
import { useState, useRef, useEffect } from 'react';

export default function TraitPicker({ traits, selected, onChange, label }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedSet = new Set(selected);
  const filtered = traits
    .filter(t => !selectedSet.has(t.apiName))
    .filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  const remove = (apiName) => onChange(selected.filter(s => s !== apiName));
  const add = (apiName) => {
    onChange([...selected, apiName]);
    setSearch('');
    setOpen(false);
  };

  const selectedTraits = selected.map(s => traits.find(t => t.apiName === s)).filter(Boolean);

  return (
    <div ref={ref} className="mb-3 relative">
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {selectedTraits.map(t => (
          <span key={t.apiName}
            className="text-xs px-2 py-1 rounded border border-gray-600 bg-gray-800 cursor-pointer hover:bg-red-900"
            onClick={() => remove(t.apiName)}>
            {t.name} x
          </span>
        ))}
      </div>
      <input
        type="text"
        placeholder="Szukaj..."
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-gray-800 border border-gray-600 rounded shadow-lg">
          {filtered.slice(0, 20).map(t => (
            <div key={t.apiName}
              className="px-2 py-1 text-sm hover:bg-gray-700 cursor-pointer"
              onClick={() => add(t.apiName)}>
              {t.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement full FilterPanel**

```jsx
// client/src/components/FilterPanel.jsx
import { useState, useCallback } from 'react';
import ChampionPicker from './ChampionPicker';
import TraitPicker from './TraitPicker';
import { generateTeams } from '../api';

export default function FilterPanel({ champions, traits, emblems, onResults, onLoading }) {
  const [level, setLevel] = useState(8);
  const [lockedChampions, setLockedChampions] = useState([]);
  const [lockedTraits, setLockedTraits] = useState([]);
  const [selectedEmblems, setSelectedEmblems] = useState([]);
  const [excludedChampions, setExcludedChampions] = useState([]);

  const emblemTraits = emblems
    .filter(e => e.traitApiName)
    .map(e => ({ apiName: e.traitApiName, name: e.traitName || e.name.replace(' Emblem', '') }));

  const handleGenerate = useCallback(async () => {
    onLoading(true);
    try {
      const results = await generateTeams({
        lockedChampions,
        lockedTraits,
        emblems: selectedEmblems,
        excludedChampions,
        level,
      });
      onResults(results);
    } catch (err) {
      console.error('Generate failed:', err);
    } finally {
      onLoading(false);
    }
  }, [lockedChampions, lockedTraits, selectedEmblems, excludedChampions, level, onResults, onLoading]);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Filtry</h2>

      <div className="mb-3">
        <label className="block text-sm text-gray-400 mb-1">Level</label>
        <select
          value={level}
          onChange={e => setLevel(Number(e.target.value))}
          className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm">
          {[5, 6, 7, 8, 9, 10].map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <ChampionPicker
        champions={champions}
        selected={lockedChampions}
        onChange={setLockedChampions}
        exclude={excludedChampions}
        label="Moi championowie"
      />

      <TraitPicker
        traits={traits}
        selected={lockedTraits}
        onChange={setLockedTraits}
        label="Wymagane traity"
      />

      <TraitPicker
        traits={emblemTraits.length ? emblemTraits : traits}
        selected={selectedEmblems}
        onChange={setSelectedEmblems}
        label="Emblematy"
      />

      <ChampionPicker
        champions={champions}
        selected={excludedChampions}
        onChange={setExcludedChampions}
        exclude={lockedChampions}
        label="Wyklucz"
      />

      <button
        onClick={handleGenerate}
        className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded transition-colors">
        Generuj
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify filter panel works**

Run: `npm run dev`. Open browser. Expected: Level dropdown, champion pickers with search, trait pickers, generate button. Clicking "Generuj" should show results.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/
git commit -m "feat: filter panel — champion/trait pickers with search, generate button"
```

---

### Task 11: Frontend — Results Panel + TeamCard

**Files:**
- Create: `client/src/components/TeamCard.jsx`
- Create: `client/src/components/TraitBadge.jsx`
- Modify: `client/src/components/ResultsPanel.jsx`

- [ ] **Step 1: Create TraitBadge**

```jsx
// client/src/components/TraitBadge.jsx
const STYLE_COLORS = {
  1: 'bg-amber-900 text-amber-200 border-amber-700',
  3: 'bg-gray-600 text-gray-100 border-gray-400',
  4: 'bg-yellow-800 text-yellow-100 border-yellow-500',
  5: 'bg-purple-800 text-purple-100 border-purple-400',
};

export default function TraitBadge({ trait }) {
  const colorClass = STYLE_COLORS[trait.style] || 'bg-gray-700 text-gray-300 border-gray-500';

  return (
    <span className={'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ' + colorClass}>
      <span className="font-medium">{trait.name}</span>
      <span className="opacity-75">({trait.count})</span>
      {trait.nearNext && (
        <span className="text-yellow-300 ml-1" title={'Brakuje ' + trait.nearNext.missing + ' do ' + trait.nearNext.next}>
          -1!
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Create TeamCard**

```jsx
// client/src/components/TeamCard.jsx
import TraitBadge from './TraitBadge';

const COST_COLORS = {
  1: 'border-gray-500 bg-gray-800',
  2: 'border-green-600 bg-green-950',
  3: 'border-blue-500 bg-blue-950',
  4: 'border-purple-500 bg-purple-950',
  5: 'border-yellow-500 bg-yellow-950',
};

export default function TeamCard({ team, rank }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-3 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">Team {rank}</span>
        <span className="text-sm font-mono bg-gray-700 px-2 py-0.5 rounded">
          Score: {Math.round(team.score)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {team.champions.map(c => (
          <div key={c.apiName}
            className={'px-3 py-1.5 rounded border text-sm ' + (COST_COLORS[c.cost] || 'border-gray-600 bg-gray-800')}
            title={c.name + ' (' + c.cost + 'g) — ' + (c.traits || []).join(', ')}>
            {c.name}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {team.activeTraits
          .sort((a, b) => b.style - a.style)
          .map(t => (
            <TraitBadge key={t.apiName} trait={t} />
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update ResultsPanel**

```jsx
// client/src/components/ResultsPanel.jsx
import TeamCard from './TeamCard';

export default function ResultsPanel({ results, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400 animate-pulse">Generuje teamy...</p>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Ustaw filtry i kliknij Generuj</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">
        Wyniki <span className="text-gray-400 font-normal">({results.length})</span>
      </h2>
      {results.map((team, i) => (
        <TeamCard key={i} team={team} rank={i + 1} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify results display**

Run: `npm run dev`. Import data, generate teams. Expected: Team cards with champion chips (colored by cost), trait badges (colored by breakpoint style), score.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/
git commit -m "feat: results panel — TeamCard with champion chips, trait badges, score"
```

---

### Task 12: AI Chat — Ollama Integration (Backend)

**Files:**
- Create: `server/src/routes/chat.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Implement chat route with Ollama**

```js
// server/src/routes/chat.js
import { Router } from 'express';
import { generateTeams } from '../scoring/engine.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

function buildSystemPrompt(db) {
  const champions = db.prepare(`
    SELECT c.name, c.cost, GROUP_CONCAT(t.name, ', ') as traits
    FROM champions c
    LEFT JOIN champion_traits ct ON ct.championId = c.id
    LEFT JOIN traits t ON t.id = ct.traitId
    GROUP BY c.id ORDER BY c.name
  `).all();

  const champList = champions.map(c => c.name + ' (' + c.cost + 'g) [' + c.traits + ']').join('\n');

  return 'Jestes asystentem TFT Set 17 "Space Gods".\n\n' +
    'Twoja rola: parsuj zapytania gracza na JSON z constraintami do generatora teamow.\n\n' +
    'Zwroc TYLKO JSON w formacie:\n' +
    '{\n' +
    '  "lockedChampions": ["TFT17_NazwaApi"],\n' +
    '  "lockedTraits": ["TFT17_NazwaApi"],\n' +
    '  "emblems": ["TFT17_NazwaApi"],\n' +
    '  "excludedChampions": ["TFT17_NazwaApi"],\n' +
    '  "level": 8\n' +
    '}\n\n' +
    'Pola moga byc puste tablice. Level domyslnie 8.\n' +
    'Dla nazw API championow: dodaj prefix "TFT17_" do nazwy championa (np. "Jhin" -> "TFT17_Jhin").\n' +
    'Dla nazw API traitow: dodaj prefix "TFT17_" do nazwy traitu (np. "Sniper" -> "TFT17_Sniper").\n\n' +
    'Dostepni championowie:\n' + champList;
}

const CONSTRAINTS_SCHEMA = {
  type: 'object',
  properties: {
    lockedChampions: { type: 'array', items: { type: 'string' } },
    lockedTraits: { type: 'array', items: { type: 'string' } },
    emblems: { type: 'array', items: { type: 'string' } },
    excludedChampions: { type: 'array', items: { type: 'string' } },
    level: { type: 'integer', minimum: 1, maximum: 10 },
  },
  required: ['lockedChampions', 'lockedTraits', 'emblems', 'excludedChampions', 'level'],
};

export function chatRoutes(db) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    try {
      // Step 1: Parse user message into constraints via Ollama
      const systemPrompt = buildSystemPrompt(db);
      const parseResponse = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          format: CONSTRAINTS_SCHEMA,
          stream: false,
          options: { temperature: 0 },
        }),
      });

      if (!parseResponse.ok) {
        const err = await parseResponse.text();
        return res.status(502).json({ error: 'Ollama error: ' + err });
      }

      const parseResult = await parseResponse.json();
      let constraints;
      try {
        constraints = JSON.parse(parseResult.message.content);
      } catch {
        return res.json({
          reply: parseResult.message.content,
          teams: [],
          constraints: null,
        });
      }

      // Step 2: Run scoring engine
      const teams = generateTeams(db, constraints, { topN: 10, iterations: 500 });

      // Step 3: Format response via Ollama
      const top3 = teams.slice(0, 3).map((t, i) =>
        (i + 1) + '. ' + t.champions.map(c => c.name).join(', ') +
        ' — Score: ' + Math.round(t.score) +
        ' — Traity: ' + t.activeTraits.map(tr => tr.name + '(' + tr.count + ')').join(', ')
      ).join('\n');

      const summaryPrompt = 'Gracz zapytal: "' + message + '"\n' +
        'Zrozumialem constraints: ' + JSON.stringify(constraints) + '\n' +
        'Znalazlem ' + teams.length + ' teamow. Top 3:\n' + top3 + '\n\n' +
        'Skomentuj krotko wyniki po polsku (2-3 zdania max). Skup sie na synergii traitow.';

      const commentResponse = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: 'Jestes zwiezlym asystentem TFT. Odpowiadaj po polsku, krotko.' },
            { role: 'user', content: summaryPrompt },
          ],
          stream: false,
          options: { temperature: 0.3 },
        }),
      });

      let reply = '';
      if (commentResponse.ok) {
        const commentResult = await commentResponse.json();
        reply = commentResult.message.content;
      }

      res.json({ reply, teams, constraints });
    } catch (err) {
      console.error('Chat error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Add chat route to server**

Update `server/src/index.js` — add import at top:

```js
import { chatRoutes } from './routes/chat.js';
```

And add after other routes:

```js
app.use('/api/chat', chatRoutes(db));
```

Full final `server/src/index.js`:

```js
import express from 'express';
import cors from 'cors';
import { createDb } from './db.js';
import { championRoutes } from './routes/champions.js';
import { traitRoutes } from './routes/traits.js';
import { itemRoutes } from './routes/items.js';
import { importRoutes } from './routes/import.js';
import { generateRoutes } from './routes/generate.js';
import { chatRoutes } from './routes/chat.js';

const db = createDb('tft.db');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/champions', championRoutes(db));
app.use('/api/traits', traitRoutes(db));
app.use('/api/items', itemRoutes(db));
app.use('/api/import', importRoutes(db));
app.use('/api/generate', generateRoutes(db));
app.use('/api/chat', chatRoutes(db));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});

export { app, db };
```

- [ ] **Step 3: Test with curl (requires Ollama running with qwen3:8b)**

Run:
```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"mam jhina i 2 emblematy dark star i sniper, level 8"}'
```

Expected: JSON with `reply` (Polish comment), `teams` (array), `constraints` (parsed).

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/chat.js server/src/index.js
git commit -m "feat: AI chat route — Ollama NLU + scoring + commentary"
```

---

### Task 13: Frontend — Chat Panel

**Files:**
- Modify: `client/src/components/ChatPanel.jsx`

- [ ] **Step 1: Implement ChatPanel**

```jsx
// client/src/components/ChatPanel.jsx
import { useState, useRef, useEffect } from 'react';
import { sendChat } from '../api';

export default function ChatPanel({ onResults }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const result = await sendChat(text);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.reply || 'Brak odpowiedzi',
        constraints: result.constraints,
      }]);
      if (result.teams && result.teams.length) {
        onResults(result.teams);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Blad: ' + err.message,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-700">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-2 text-sm text-gray-400 hover:text-white flex items-center gap-2">
        <span>{collapsed ? '>' : 'v'}</span>
        AI Chat
        {loading && <span className="animate-pulse text-blue-400 ml-2">mysle...</span>}
      </button>

      {!collapsed && (
        <div className="px-4 pb-3">
          <div className="max-h-48 overflow-y-auto mb-2 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={'text-sm ' + (msg.role === 'user' ? 'text-blue-300' : 'text-gray-300')}>
                <span className="text-gray-500">{msg.role === 'user' ? '> ' : '< '}</span>
                {msg.content}
                {msg.constraints && (
                  <span className="text-gray-600 text-xs ml-2">
                    [{JSON.stringify(msg.constraints)}]
                  </span>
                )}
              </div>
            ))}
            <div ref={scrollRef} />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="np. mam jhina i 2 emblematy dark star sniper, lv8"
              disabled={loading}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white px-4 py-1.5 rounded text-sm transition-colors">
              Wyslij
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify chat works end-to-end**

Run: `npm run dev` (with Ollama running and `qwen3:8b` pulled).
Open browser. Type a message in chat. Expected: AI parses it, results panel updates with generated teams.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ChatPanel.jsx
git commit -m "feat: AI chat panel — send message, display conversation, update results"
```

---

### Task 14: Import Button + Final Wiring

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Add import button and data refresh to App**

```jsx
// client/src/App.jsx
import { useState, useEffect, useCallback } from 'react';
import { fetchChampions, fetchTraits, fetchItems, importData } from './api';
import FilterPanel from './components/FilterPanel';
import ResultsPanel from './components/ResultsPanel';
import ChatPanel from './components/ChatPanel';

export default function App() {
  const [champions, setChampions] = useState([]);
  const [traits, setTraits] = useState([]);
  const [emblems, setEmblems] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [c, t, e] = await Promise.all([
        fetchChampions(),
        fetchTraits(),
        fetchItems({ emblems: true }),
      ]);
      setChampions(c);
      setTraits(t);
      setEmblems(e);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await importData();
      console.log('Import result:', result);
      await loadData();
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">TFT Generator</h1>
          <p className="text-sm text-gray-400">Set 17 — Space Gods</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {champions.length} championow
          </span>
          <button
            onClick={handleImport}
            disabled={importing}
            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm px-3 py-1.5 rounded transition-colors">
            {importing ? 'Importuje...' : 'Odswiez dane'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 border-r border-gray-700 p-4 overflow-y-auto shrink-0">
          <FilterPanel
            champions={champions}
            traits={traits}
            emblems={emblems}
            onResults={setResults}
            onLoading={setLoading}
          />
        </aside>
        <main className="flex-1 p-4 overflow-y-auto">
          <ResultsPanel results={results} loading={loading} />
        </main>
      </div>

      <ChatPanel onResults={setResults} />
    </div>
  );
}
```

- [ ] **Step 2: Verify full flow**

Run: `npm run dev`

1. Click "Odswiez dane" — should import from Community Dragon
2. Select champions in filters — click "Generuj" — results appear
3. Type in AI chat — results update
4. All 3 panels work together

- [ ] **Step 3: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: import button, data refresh, final app wiring"
```

---

### Task 15: Run All Tests + Final Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd server && npx vitest run`
Expected: All tests pass (scorer, candidates, engine, importer, db).

- [ ] **Step 2: Manual end-to-end verification**

1. `npm run import` — import data from CDragon
2. `npm run dev` — start both client and server
3. Open `http://localhost:5173`
4. Verify: champion count shows in header
5. Add a champion to "Moi championowie"
6. Click "Generuj" — verify teams appear with that champion in all of them
7. Open AI chat — type a query — verify response

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, e2e working"
```
