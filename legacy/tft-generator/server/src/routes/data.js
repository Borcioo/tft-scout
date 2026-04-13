import { Router } from 'express';
import { importFromCDragon } from '../data/cdragon-importer.js';

export function createDataRoutes(db, scoutService) {
  const router = Router();

  router.post('/import', async (req, res) => {
    try {
      const counts = await importFromCDragon(db);
      res.json({ success: true, ...counts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/status', async (req, res) => {
    try {
      const stats = await scoutService.stats();
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
