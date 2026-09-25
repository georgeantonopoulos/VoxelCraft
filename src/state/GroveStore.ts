import { create } from 'zustand';
import {
  applyStat,
  computeVitality,
  initialProgression,
  GroveNotice,
  GroveStatKey,
  ProgressionState,
} from '@features/grove/questLine';

/**
 * GroveStore — Keeper progression for the current world.
 *
 * Owns the quest line position, essence, lifetime stats, restored Root Hollows
 * and discovered biomes. Rules live in `questLine.ts`; this store only applies
 * them and persists the result to localStorage, keyed by world seed so every
 * world has its own story.
 */

export interface GroveToast extends Readonly<{ id: number }> {
  notice: GroveNotice;
}

export type CompassTargetKind = 'hollow' | 'grove';

export interface CompassTarget {
  kind: CompassTargetKind;
  x: number;
  z: number;
  distance: number;
  /** Bearing in radians relative to world -Z (forward), clockwise positive. */
  bearing: number;
}

interface PersistedGrove {
  version: 1;
  progression: ProgressionState;
  restoredHollows: string[];
  foundHollows: string[];
  discoveredBiomes: string[];
}

interface GroveState {
  seed: number | null;
  progression: ProgressionState;
  restoredHollows: Record<string, true>;
  foundHollows: Record<string, true>;
  discoveredBiomes: string[];
  vitality: number;
  toasts: GroveToast[];
  compass: CompassTarget | null;
  /** performance.now() of the last restoration, drives the world pulse effect. */
  lastRestoreAt: number;

  bindWorld: (seed: number) => void;
  record: (stat: GroveStatKey, amount?: number) => void;
  markHollowFound: (id: string) => void;
  markHollowRestored: (id: string) => void;
  discoverBiome: (biome: string) => void;
  setCompass: (target: CompassTarget | null) => void;
  announce: (notice: GroveNotice) => void;
  dismissToast: (id: number) => void;
  resetWorld: () => void;
}

const STORAGE_PREFIX = 'vc-grove-v1-';
let toastSeq = 1;

const loadPersisted = (seed: number): PersistedGrove | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + seed);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedGrove;
    if (parsed?.version !== 1 || !parsed.progression) return null;
    return parsed;
  } catch {
    return null;
  }
};

let saveHandle: ReturnType<typeof setTimeout> | null = null;
const schedulePersist = (get: () => GroveState) => {
  if (typeof window === 'undefined') return;
  if (saveHandle) clearTimeout(saveHandle);
  saveHandle = setTimeout(() => {
    saveHandle = null;
    const s = get();
    if (s.seed == null) return;
    const payload: PersistedGrove = {
      version: 1,
      progression: s.progression,
      restoredHollows: Object.keys(s.restoredHollows),
      foundHollows: Object.keys(s.foundHollows),
      discoveredBiomes: s.discoveredBiomes,
    };
    try {
      window.localStorage.setItem(STORAGE_PREFIX + s.seed, JSON.stringify(payload));
    } catch {
      // Storage full or blocked (private mode) - progression stays in memory.
    }
  }, 500);
};

const toSet = (ids: string[]): Record<string, true> => {
  const out: Record<string, true> = {};
  for (const id of ids) out[id] = true;
  return out;
};

const MAX_TOASTS = 4;

export const useGroveStore = create<GroveState>((set, get) => {
  const pushNotices = (notices: GroveNotice[]): GroveToast[] => {
    const current = get().toasts;
    if (notices.length === 0) return current;
    const next = [...current, ...notices.map((notice) => ({ id: toastSeq++, notice }))];
    return next.slice(-MAX_TOASTS);
  };

  const apply = (stat: GroveStatKey, amount: number) => {
    const { state, notices } = applyStat(get().progression, stat, amount);
    set({
      progression: state,
      vitality: computeVitality(state.stats),
      toasts: pushNotices(notices),
    });
    schedulePersist(get);
  };

  return {
    seed: null,
    progression: initialProgression(),
    restoredHollows: {},
    foundHollows: {},
    discoveredBiomes: [],
    vitality: computeVitality(initialProgression().stats),
    toasts: [],
    compass: null,
    lastRestoreAt: -Infinity,

    bindWorld: (seed) => {
      if (get().seed === seed) return;
      const saved = typeof window !== 'undefined' ? loadPersisted(seed) : null;
      const progression = saved?.progression ?? initialProgression();
      set({
        seed,
        progression,
        restoredHollows: toSet(saved?.restoredHollows ?? []),
        foundHollows: toSet(saved?.foundHollows ?? []),
        discoveredBiomes: saved?.discoveredBiomes ?? [],
        vitality: computeVitality(progression.stats),
        toasts: [],
        compass: null,
        lastRestoreAt: -Infinity,
      });
    },

    record: (stat, amount = 1) => apply(stat, amount),

    markHollowFound: (id) => {
      if (get().foundHollows[id]) return;
      set({ foundHollows: { ...get().foundHollows, [id]: true } });
      apply('hollowsFound', 1);
    },

    markHollowRestored: (id) => {
      if (get().restoredHollows[id]) return;
      set({
        restoredHollows: { ...get().restoredHollows, [id]: true },
        foundHollows: { ...get().foundHollows, [id]: true },
        lastRestoreAt: typeof performance !== 'undefined' ? performance.now() : 0,
      });
      apply('hollowsRestored', 1);
    },

    discoverBiome: (biome) => {
      if (get().discoveredBiomes.includes(biome)) return;
      const pretty = biome
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      set({
        discoveredBiomes: [...get().discoveredBiomes, biome],
        toasts: pushNotices([{ kind: 'discovery', title: pretty, detail: 'New land discovered' }]),
      });
      apply('biomesDiscovered', 1);
    },

    setCompass: (target) => set({ compass: target }),

    announce: (notice) => set({ toasts: pushNotices([notice]) }),

    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    resetWorld: () => {
      if (saveHandle) { clearTimeout(saveHandle); saveHandle = null; }
      const progression = initialProgression();
      set({
        seed: null,
        progression,
        restoredHollows: {},
        foundHollows: {},
        discoveredBiomes: [],
        vitality: computeVitality(progression.stats),
        toasts: [],
        compass: null,
        lastRestoreAt: -Infinity,
      });
    },
  };
});

// Console access for debugging progression: window.__groveStore.getState()
if (typeof window !== 'undefined') {
  (window as unknown as { __groveStore?: typeof useGroveStore }).__groveStore = useGroveStore;
}
