import { Router } from 'express';

export function createRatingsRoutes(ratingsService) {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const [unitRatings, traitRatings] = await Promise.all([
        ratingsService.getUnitRatings(),
        ratingsService.getTraitRatings(),
      ]);
      res.json({ unitRatings, traitRatings });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/affinity/:unitApiName', async (req, res) => {
    try {
      const affinity = await ratingsService.getAffinity(req.params.unitApiName);
      res.json({ unitApiName: req.params.unitApiName, affinity });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/refresh', async (req, res) => {
    try {
      const ctx = await ratingsService.buildScoringContext([]);
      res.json({
        unitRatings: Object.keys(ctx.unitRatings).length,
        traitRatings: Object.keys(ctx.traitRatings).length,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
