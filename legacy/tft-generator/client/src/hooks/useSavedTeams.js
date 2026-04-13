/**
 * useSavedTeams — reactive access to the saved-teams storage.
 *
 * Consumers call toggle(comp, ctx) with the worker-shaped comp object,
 * not with a pre-shaped SavedTeam. The hook handles the mapping via
 * mapCompToSavedTeam.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  listSavedTeams,
  isTeamSaved,
  toggleSaveTeam,
  unsaveTeam,
  updateSavedTeam,
} from '@/storage/savedTeams';

const STORAGE_KEY = 'tft-scout:saved-teams';

/**
 * Map a worker-shaped comp object to a SavedTeam payload.
 */
export function mapCompToSavedTeam(comp, { level, emblems = [], lockedChampions = [] }) {
  const championApis = (comp.champions || []).map(c => c.apiName);
  return {
    championApis,
    level,
    emblems,
    lockedChampions,
    savedScore: comp.score ?? null,
  };
}

export function useSavedTeams(setVersion = null) {
  const [teams, setTeams] = useState(() => listSavedTeams(setVersion));

  useEffect(() => {
    setTeams(listSavedTeams(setVersion));
  }, [setVersion]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setTeams(listSavedTeams(setVersion));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [setVersion]);

  const toggle = useCallback((comp, ctx) => {
    const team = mapCompToSavedTeam(comp, ctx);
    const result = toggleSaveTeam(team);
    setTeams(listSavedTeams(setVersion));
    return result;
  }, [setVersion]);

  const isSaved = useCallback((comp, ctx) => {
    const team = mapCompToSavedTeam(comp, ctx);
    return isTeamSaved(team);
  }, [teams]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useCallback((id) => {
    unsaveTeam(id);
    setTeams(listSavedTeams(setVersion));
  }, [setVersion]);

  const updateTitle = useCallback((id, title) => {
    updateSavedTeam(id, { title });
    setTeams(listSavedTeams(setVersion));
  }, [setVersion]);

  return { teams, toggle, isSaved, remove, updateTitle };
}
