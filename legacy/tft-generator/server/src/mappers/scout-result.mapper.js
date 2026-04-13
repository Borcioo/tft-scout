/**
 * Scout result mapper — translates algorithm output to API response.
 */

/** Algorithm result → API response */
export function toApi(result) {
  return {
    champions: result.champions.map(c => ({
      apiName: c.apiName,
      baseApiName: c.baseApiName || null,
      name: c.name,
      cost: c.cost,
      role: c.role,
      traits: c.traits,
      traitNames: c.traitNames || c.traits,
      variant: c.variant || null,
      slotsUsed: c.slotsUsed || 1,
      icon: c.icon || '',
    })),
    activeTraits: result.activeTraits.map(t => ({
      apiName: t.apiName,
      name: t.name,
      icon: t.icon || null,
      count: t.count,
      style: t.activeStyle || null,
      breakpoint: t.activeBreakpoint || null,
    })),
    score: Math.round(result.score * 100) / 100,
    breakdown: result.breakdown || null,
    itemBuilds: result.itemBuilds || null,
    level: result.level,
    slotsUsed: result.slotsUsed,
    roles: result.roles || null,
    metaMatch: result.metaMatch || null,
  };
}

/** Multiple results → API response */
export function manyToApi(results) {
  return results.map(toApi);
}
