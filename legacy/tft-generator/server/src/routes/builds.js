import { Router } from 'express';

export function createBuildsRoutes(ratingsService) {
  const router = Router();

  /** GET /api/builds/:unitApiName — lazy load item builds per champion */
  router.get('/:unitApiName', async (req, res) => {
    try {
      const { unitApiName } = req.params;
      const [topItems, itemSets] = await Promise.all([
        ratingsService.getItemBuilds(unitApiName),
        ratingsService.getItemSets(unitApiName),
      ]);
      res.json({ unitApiName, topItems, itemSets });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
