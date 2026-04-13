import { Router } from 'express';
import { toApi } from '../mappers/champion.mapper.js';

export function createChampionRoutes(championService) {
  const router = Router();

  router.get('/', (req, res) => {
    const champions = championService.getAllChampions();
    const { cost, trait } = req.query;

    let filtered = champions;
    if (cost) filtered = filtered.filter(c => c.cost === Number(cost));
    if (trait) filtered = filtered.filter(c => c.traits.includes(trait));

    res.json(filtered.map(toApi));
  });

  return router;
}
