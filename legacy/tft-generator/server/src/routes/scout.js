import { Router } from 'express';
import { manyToApi } from '../mappers/scout-result.mapper.js';

export function createScoutRoutes(scoutService) {
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const { teams, insights } = await scoutService.generateComps(req.body);
      res.json({ results: manyToApi(teams), insights });
    } catch (e) {
      console.error('[Scout]', e);
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/road-to', async (req, res) => {
    try {
      const results = await scoutService.generateRoadTo(req.body);
      res.json({ results: manyToApi(results) });
    } catch (e) {
      console.error('[Scout/RoadTo]', e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
