import { Router } from 'express';

export function createScoutContextRoute(championService, ratingsService) {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const [champions, traits, exclusionGroups, scoringCtx] = await Promise.all([
        Promise.resolve(championService.getAllChampions()),
        Promise.resolve(championService.getAllTraits()),
        Promise.resolve(championService.getExclusionGroups()),
        ratingsService.buildScoringContext(),
      ]);

      res.json({ champions, traits, exclusionGroups, scoringCtx });
    } catch (e) {
      console.error('[ScoutContext]', e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
