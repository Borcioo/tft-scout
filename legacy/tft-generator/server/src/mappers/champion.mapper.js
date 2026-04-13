/**
 * Champion mapper — translates between DB rows, domain objects, and API responses.
 */

/** DB row (with GROUP_CONCAT traits) → domain object for algorithm */
export function fromDb(row) {
  return {
    apiName: row.apiName,
    baseApiName: row.baseApiName || null,
    name: row.name,
    variant: row.variant || null,
    cost: row.cost,
    slotsUsed: row.slotsUsed || 1,
    role: row.role,
    traits: row.traitApiNames ? row.traitApiNames.split(',') : [],
    traitNames: row.traitNames ? row.traitNames.split(',') : [],
    icon: row.icon || '',
    plannerCode: row.plannerCode ?? null,
    stats: {
      hp: row.hp,
      armor: row.armor,
      magicResist: row.magicResist,
      attackDamage: row.attackDamage,
      attackSpeed: row.attackSpeed,
      mana: row.mana,
      startMana: row.startMana,
      range: row.range,
      critChance: row.critChance,
      critMultiplier: row.critMultiplier,
    },
  };
}

/** Domain object → API response (what frontend sees) */
export function toApi(champ) {
  return {
    apiName: champ.apiName,
    baseApiName: champ.baseApiName,
    name: champ.name,
    variant: champ.variant,
    cost: champ.cost,
    slotsUsed: champ.slotsUsed,
    role: champ.role,
    traits: champ.traits,
    traitNames: champ.traitNames,
    icon: champ.icon,
    plannerCode: champ.plannerCode ?? null,
  };
}
