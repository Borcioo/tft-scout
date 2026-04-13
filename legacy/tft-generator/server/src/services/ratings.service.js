/**
 * Ratings Service — provides scoring data to the algorithm layer.
 *
 * Sits between cache layer and algorithm. Returns plain JS objects
 * that the algorithm consumes via scoringCtx.
 *
 * Data flows:
 *   MetaTFT API → cache → aggregators → DB tables → this service → algorithm
 */

import { unitRatingFromDb, traitRatingFromDb, affinityFromDb } from '../mappers/ratings.mapper.js';

export function createRatingsService(db, metatftCache) {

  return {
    /**
     * Get all unit ratings as { apiName → { score, avgPlace, games, ... } }
     * Fetches from MetaTFT if no cached data exists.
     */
    async getUnitRatings() {
      // Ensure we have data (triggers fetch + aggregation if needed)
      await metatftCache.fetch('units');

      const rows = db.prepare('SELECT * FROM unit_ratings').all();
      const map = {};
      for (const row of rows) {
        const rating = unitRatingFromDb(row);
        map[rating.apiName] = rating;
      }
      return map;
    },

    /**
     * Get all trait ratings as { traitApiName → { position → { score, avgPlace, games, ... } } }
     */
    async getTraitRatings() {
      await metatftCache.fetch('traits');

      const rows = db.prepare('SELECT * FROM trait_ratings').all();
      const map = {};
      for (const row of rows) {
        const rating = traitRatingFromDb(row);
        if (!map[rating.traitApiName]) map[rating.traitApiName] = {};
        map[rating.traitApiName][rating.breakpointPosition] = rating;
      }
      return map;
    },

    /**
     * Get trait affinity for a specific champion.
     * Fetches from MetaTFT Explorer if no cached data exists.
     * Returns array of { traitApiName, breakpointPosition, avgPlace, games, frequency }
     */
    async getAffinity(unitApiName) {
      // Always use base apiName for lookup (MetaTFT doesn't know about our variants)
      const baseApiName = unitApiName.replace(/_(enhanced|conduit|challenger|replicator)$/, '');

      const existing = db.prepare(
        'SELECT * FROM unit_trait_affinity WHERE unitApiName = ?'
      ).all(baseApiName);

      if (existing.length > 0) {
        return existing.map(affinityFromDb);
      }

      try {
        await metatftCache.fetch('explorer/traits', {
          unit_unique: baseApiName + '-1',
          formatnoarray: 'true',
          compact: 'true',
        });
      } catch (e) {
        console.warn(`[Ratings] Failed to fetch affinity for ${baseApiName}:`, e.message);
        return [];
      }

      return db.prepare(
        'SELECT * FROM unit_trait_affinity WHERE unitApiName = ?'
      ).all(baseApiName).map(affinityFromDb);
    },

    /**
     * Get affinity for multiple champions at once.
     * Returns { apiName → affinityArray }
     */
    async getAffinityBulk(unitApiNames) {
      const result = {};
      await Promise.all(unitApiNames.map(async api => {
        // Store under base apiName — scorer looks up via baseApiName || apiName
        const baseApi = api.replace(/_(enhanced|conduit|challenger|replicator)$/, '');
        if (!result[baseApi]) {
          result[baseApi] = await this.getAffinity(api);
        }
      }));
      return result;
    },

    /**
     * Get best items for a champion.
     * Returns array of { itemApiName, avgPlace, games, frequency } sorted by avgPlace.
     */
    /**
     * Get full 3-item build sets for a champion.
     * Returns array of { items: [{apiName, name}], avgPlace, games }
     */
    async getItemSets(unitApiName) {
      const baseApiName = unitApiName.replace(/_(enhanced|conduit|challenger|replicator)$/, '');

      let rows = db.prepare(
        'SELECT * FROM unit_item_sets WHERE unitApiName = ? ORDER BY avgPlace ASC'
      ).all(baseApiName);

      if (rows.length === 0) {
        await this.getUnitRatings();
        try {
          await metatftCache.fetch('unit_items', { unit: baseApiName });
        } catch (e) {
          console.warn(`[Ratings] Failed to fetch item sets for ${baseApiName}:`, e.message);
          return [];
        }
        rows = db.prepare(
          'SELECT * FROM unit_item_sets WHERE unitApiName = ? ORDER BY avgPlace ASC'
        ).all(baseApiName);
      }

      // Filter: 3 real items, no emblems, minimum games
      let filtered = rows.filter(r => {
        const items = JSON.parse(r.items);
        if (items.length !== 3) return false;
        // Exclude emblems, radiant items, anomaly items, artifacts, component items
        if (items.some(i =>
          i.includes('Emblem') || i.includes('Radiant') || i.includes('Anomaly') ||
          i.includes('Artifact') || i.includes('Offering') || i.includes('Ornn')
        )) return false;
        return r.games >= 100;
      });
      // Relax games filter if not enough results
      if (filtered.length < 3) {
        filtered = rows.filter(r => {
          const items = JSON.parse(r.items);
          if (items.length !== 3) return false;
          return !items.some(i =>
            i.includes('Emblem') || i.includes('Radiant') || i.includes('Anomaly') ||
            i.includes('Artifact') || i.includes('Offering') || i.includes('Ornn')
          );
        }).slice(0, 5);
      }

      const resolveItem = (api) => {
        const row = db.prepare('SELECT name FROM items WHERE apiName = ?').get(api);
        return { apiName: api, name: row?.name || api.replace('TFT_Item_', '') };
      };

      // Tier based on placement improvement vs champion's baseline
      // MetaTFT style: "improves your placement by X"
      const unitRating = db.prepare('SELECT avgPlace FROM unit_ratings WHERE apiName = ?').get(baseApiName);
      const unitAvg = unitRating?.avgPlace || 4.5;
      const tierOf = (avg) => {
        const improvement = unitAvg - avg;
        if (improvement >= 0.15) return 'S';
        if (improvement >= 0.0) return 'A';
        if (improvement >= -0.2) return 'B';
        return 'C';
      };

      const sets = filtered.slice(0, 5).map(r => {
        const itemApis = JSON.parse(r.items);
        return {
          items: itemApis.map(resolveItem),
          avgPlace: Math.round(r.avgPlace * 100) / 100,
          games: r.games,
          tier: tierOf(r.avgPlace),
        };
      });


      return sets;
    },

    async getItemBuilds(unitApiName) {
      const baseApiName = unitApiName.replace(/_(enhanced|conduit|challenger|replicator)$/, '');

      const existing = db.prepare(
        'SELECT * FROM unit_item_builds WHERE unitApiName = ? ORDER BY avgPlace ASC'
      ).all(baseApiName);

      if (existing.length > 0) return existing;

      // Ensure unit_ratings exist first (aggregator needs totalGames)
      await this.getUnitRatings();

      try {
        await metatftCache.fetch('unit_items', {
          unit: baseApiName,
          num_items: '3',
        });
      } catch (e) {
        console.warn(`[Ratings] Failed to fetch items for ${baseApiName}:`, e.message);
        return [];
      }

      return db.prepare(
        'SELECT * FROM unit_item_builds WHERE unitApiName = ? ORDER BY avgPlace ASC'
      ).all(baseApiName);
    },

    /**
     * Get item builds for all champions in a team.
     * Returns { apiName → top 3 items }
     */
    async getTeamItemBuilds(championApiNames) {
      const MIN_ITEM_GAMES = 15;

      // Item metadata cache
      const itemMetaCache = {};
      function getItemMeta(apiName) {
        if (itemMetaCache[apiName]) return itemMetaCache[apiName];
        const row = db.prepare('SELECT name, isEmblem FROM items WHERE apiName = ?').get(apiName);
        const meta = {
          name: row?.name || apiName.replace('TFT_Item_', '').replace(/([A-Z])/g, ' $1').trim(),
          isEmblem: row?.isEmblem === 1 || apiName.includes('Emblem'),
        };
        itemMetaCache[apiName] = meta;
        return meta;
      }

      const result = {};
      await Promise.all(championApiNames.map(async api => {
        const builds = await this.getItemBuilds(api);
        result[api] = builds
          .filter(b => {
            if (b.games < MIN_ITEM_GAMES) return false;
            const meta = getItemMeta(b.itemApiName);
            if (meta.isEmblem) return false;
            return true;
          })
          .slice(0, 3)
          .map(b => ({
            itemApiName: b.itemApiName,
            itemName: getItemMeta(b.itemApiName).name,
            avgPlace: Math.round(b.avgPlace * 100) / 100,
            games: b.games,
          }));
      }));
      return result;
    },

    /**
     * Get companion champions — "which champions does this unit perform best with?"
     * Returns array of { companionApiName, avgPlace, games, frequency }
     */
    async getCompanions(unitApiName) {
      const baseApiName = unitApiName.replace(/_(enhanced|conduit|challenger|replicator)$/, '');

      const existing = db.prepare(
        'SELECT * FROM unit_companions WHERE unitApiName = ? ORDER BY avgPlace ASC'
      ).all(baseApiName);

      if (existing.length > 0) return existing;

      await this.getUnitRatings();
      try {
        await metatftCache.fetch('explorer/units', {
          unit_unique: baseApiName + '-1',
          formatnoarray: 'true',
          compact: 'true',
        });
      } catch (e) {
        console.warn(`[Ratings] Failed to fetch companions for ${baseApiName}:`, e.message);
        return [];
      }

      return db.prepare(
        'SELECT * FROM unit_companions WHERE unitApiName = ? ORDER BY avgPlace ASC'
      ).all(baseApiName);
    },

    /**
     * Get style fallback scores from DB.
     * Returns { 'Bronze' → 0.22, 'Gold' → 1.2, ... }
     */
    getStyleScores() {
      const rows = db.prepare('SELECT name, fallbackScore FROM trait_styles').all();
      const map = {};
      for (const r of rows) map[r.name] = r.fallbackScore;
      return map;
    },

    /**
     * Build full scoringCtx for the algorithm.
     * Optionally fetches affinity for specific champions.
     */
    async buildScoringContext(lockedChampionApis = []) {
      const [unitRatings, traitRatings] = await Promise.all([
        this.getUnitRatings(),
        this.getTraitRatings(),
      ]);

      const styleScores = this.getStyleScores();

      // Load all affinity + companions from DB (already populated by npm run fetch)
      const affinity = {};
      for (const row of db.prepare('SELECT * FROM unit_trait_affinity').all()) {
        const r = affinityFromDb(row);
        (affinity[row.unitApiName] ??= []).push(r);
      }
      const companions = {};
      for (const row of db.prepare('SELECT * FROM unit_companions ORDER BY avgPlace ASC').all()) {
        (companions[row.unitApiName] ??= []).push(row);
      }

      // Load meta comps for seeding + match detection
      const metaComps = db.prepare(
        'SELECT units, avgPlace, games, name FROM meta_comps WHERE games >= 1000 ORDER BY avgPlace'
      ).all().map(r => ({
        units: JSON.parse(r.units),
        avgPlace: r.avgPlace,
        games: r.games,
        name: r.name,
      }));

      return { unitRatings, traitRatings, styleScores, affinity, companions, metaComps };
    },

    /** Cache stats */
    stats() {
      return {
        unitRatings: db.prepare('SELECT COUNT(*) as c FROM unit_ratings').get().c,
        traitRatings: db.prepare('SELECT COUNT(*) as c FROM trait_ratings').get().c,
        affinity: db.prepare('SELECT COUNT(DISTINCT unitApiName) as c FROM unit_trait_affinity').get().c,
        cache: metatftCache.stats(),
      };
    },
  };
}
