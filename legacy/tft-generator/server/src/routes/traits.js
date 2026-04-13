import { Router } from 'express';
import { toApi } from '../mappers/trait.mapper.js';

export function createTraitRoutes(championService) {
  const router = Router();

  router.get('/', (req, res) => {
    const traits = championService.getAllTraits();
    res.json(traits.map(toApi));
  });

  return router;
}
