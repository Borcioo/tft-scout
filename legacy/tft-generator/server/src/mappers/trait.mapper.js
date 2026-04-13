/**
 * Trait mapper — translates between DB rows and domain objects.
 */

/**
 * DB trait row + breakpoint rows → domain object
 * @param {object} traitRow - row from traits table
 * @param {object[]} breakpointRows - rows from trait_breakpoints JOIN trait_styles
 */
export function fromDb(traitRow, breakpointRows = []) {
  return {
    apiName: traitRow.apiName,
    name: traitRow.name,
    description: traitRow.description,
    icon: traitRow.icon,
    isUnique: traitRow.isUnique === 1,
    breakpoints: breakpointRows.map(bp => ({
      position: bp.position,
      minUnits: bp.minUnits,
      maxUnits: bp.maxUnits,
      style: bp.styleName || bp.style,
      styleId: bp.styleId,
      effects: typeof bp.effects === 'string' ? JSON.parse(bp.effects) : bp.effects,
    })),
  };
}

/** Domain object → API response */
export function toApi(trait) {
  return {
    apiName: trait.apiName,
    name: trait.name,
    description: trait.description,
    icon: trait.icon,
    isUnique: trait.isUnique,
    breakpoints: trait.breakpoints.map(bp => ({
      position: bp.position,
      minUnits: bp.minUnits,
      maxUnits: bp.maxUnits,
      style: bp.style,
    })),
  };
}
