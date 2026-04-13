/**
 * TFT Generator v2 — Database Schema
 *
 * Layers:
 *   1. Core (CDragon)     — champions, traits, breakpoints, items, exclusion groups
 *   2. Cache (MetaTFT)    — raw API response cache
 *   3. Aggregated         — processed ratings, affinity, item builds
 *   4. User               — saved teams
 */

export function createSchema(db) {
  db.exec(`

    -- ═══════════════════════════════════════════
    -- 1. CORE — CDragon definitions
    -- ═══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS trait_styles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      fallbackScore REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS traits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apiName TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      isUnique INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trait_breakpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      traitId INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      minUnits INTEGER NOT NULL,
      maxUnits INTEGER NOT NULL,
      styleId INTEGER NOT NULL REFERENCES trait_styles(id),
      effects TEXT NOT NULL DEFAULT '{}',
      UNIQUE(traitId, position)
    );

    CREATE TABLE IF NOT EXISTS champions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apiName TEXT UNIQUE NOT NULL,
      baseApiName TEXT,
      name TEXT NOT NULL,
      variant TEXT,
      cost INTEGER NOT NULL,
      slotsUsed INTEGER NOT NULL DEFAULT 1,
      role TEXT,
      hp REAL NOT NULL DEFAULT 0,
      armor REAL NOT NULL DEFAULT 0,
      magicResist REAL NOT NULL DEFAULT 0,
      attackDamage REAL NOT NULL DEFAULT 0,
      attackSpeed REAL NOT NULL DEFAULT 0,
      mana REAL NOT NULL DEFAULT 0,
      startMana REAL NOT NULL DEFAULT 0,
      range REAL NOT NULL DEFAULT 0,
      critChance REAL NOT NULL DEFAULT 0.25,
      critMultiplier REAL NOT NULL DEFAULT 1.4,
      icon TEXT NOT NULL DEFAULT '',
      plannerCode INTEGER,
      abilityDesc TEXT,
      abilityStats TEXT
    );

    CREATE TABLE IF NOT EXISTS champion_traits (
      championId INTEGER NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
      traitId INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
      PRIMARY KEY (championId, traitId)
    );

    CREATE INDEX IF NOT EXISTS idx_champion_traits_trait ON champion_traits(traitId);

    CREATE TABLE IF NOT EXISTS exclusion_groups (
      groupName TEXT NOT NULL,
      championApiName TEXT NOT NULL,
      PRIMARY KEY (groupName, championApiName)
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

    -- ═══════════════════════════════════════════
    -- 2. CACHE — Raw MetaTFT API responses
    -- ═══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS metatft_cache (
      endpoint TEXT NOT NULL,
      paramsHash TEXT NOT NULL,
      params TEXT NOT NULL,
      data TEXT NOT NULL,
      fetchedAt TEXT NOT NULL DEFAULT (datetime('now')),
      ttlSeconds INTEGER NOT NULL DEFAULT 3600,
      PRIMARY KEY (endpoint, paramsHash)
    );

    CREATE INDEX IF NOT EXISTS idx_cache_freshness ON metatft_cache(endpoint, fetchedAt);

    -- ═══════════════════════════════════════════
    -- 3. AGGREGATED — Processed from cache
    -- ═══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS unit_ratings (
      apiName TEXT PRIMARY KEY,
      avgPlace REAL NOT NULL,
      winRate REAL NOT NULL,
      top4Rate REAL NOT NULL,
      games INTEGER NOT NULL,
      score REAL NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trait_ratings (
      traitApiName TEXT NOT NULL,
      breakpointPosition INTEGER NOT NULL,
      avgPlace REAL NOT NULL,
      winRate REAL NOT NULL,
      top4Rate REAL NOT NULL,
      games INTEGER NOT NULL,
      score REAL NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (traitApiName, breakpointPosition)
    );

    CREATE TABLE IF NOT EXISTS unit_trait_affinity (
      unitApiName TEXT NOT NULL,
      traitApiName TEXT NOT NULL,
      breakpointPosition INTEGER NOT NULL,
      avgPlace REAL NOT NULL,
      games INTEGER NOT NULL,
      frequency REAL NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (unitApiName, traitApiName, breakpointPosition)
    );

    CREATE TABLE IF NOT EXISTS unit_item_builds (
      unitApiName TEXT NOT NULL,
      itemApiName TEXT NOT NULL,
      avgPlace REAL NOT NULL,
      games INTEGER NOT NULL,
      frequency REAL NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (unitApiName, itemApiName)
    );

    CREATE TABLE IF NOT EXISTS unit_item_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unitApiName TEXT NOT NULL,
      items TEXT NOT NULL,
      avgPlace REAL NOT NULL,
      games INTEGER NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_unit_item_sets_unit ON unit_item_sets(unitApiName);

    CREATE TABLE IF NOT EXISTS unit_companions (
      unitApiName TEXT NOT NULL,
      companionApiName TEXT NOT NULL,
      avgPlace REAL NOT NULL,
      games INTEGER NOT NULL,
      frequency REAL NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (unitApiName, companionApiName)
    );

    CREATE TABLE IF NOT EXISTS meta_comps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clusterId TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      units TEXT NOT NULL,
      traits TEXT NOT NULL,
      avgPlace REAL NOT NULL,
      games INTEGER NOT NULL,
      levelling TEXT,
      builds TEXT,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════
    -- 4. USER DATA
    -- ═══════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS saved_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT UNIQUE NOT NULL,
      data TEXT NOT NULL,
      note TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

  `);

  seedTraitStyles(db);
}

function seedTraitStyles(db) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM trait_styles').get();
  if (existing.c > 0) return;

  const insert = db.prepare('INSERT INTO trait_styles (id, name, fallbackScore) VALUES (?, ?, ?)');
  const seed = db.transaction(() => {
    insert.run(1, 'Bronze',    0.22);
    insert.run(3, 'Silver',    0.44);
    insert.run(4, 'Unique',    0.67);
    insert.run(5, 'Gold',      1.20);
    insert.run(6, 'Prismatic', 1.50);
  });
  seed();
}
