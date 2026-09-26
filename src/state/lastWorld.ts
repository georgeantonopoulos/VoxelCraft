import { WorldType } from '@features/terrain/logic/BiomeManager';

/**
 * The world the player last entered, so the title screen can offer
 * "Continue". Terrain edits (IndexedDB) and Grove progress (localStorage) are
 * already saved per seed; without this the title screen rolled a new random
 * seed on every launch and that progress was never reachable again.
 */
export interface LastWorld {
  type: WorldType;
  seed: number;
  enteredAt: number;
}

const KEY = 'vc-last-world-v1';

export const readLastWorld = (): LastWorld | null => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastWorld>;
    if (!parsed || typeof parsed.seed !== 'number' || !(parsed.seed > 0)) return null;
    if (!parsed.type || !(Object.values(WorldType) as string[]).includes(parsed.type)) return null;
    return { type: parsed.type, seed: parsed.seed, enteredAt: parsed.enteredAt ?? 0 };
  } catch {
    return null;
  }
};

export const writeLastWorld = (type: WorldType, seed: number): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ type, seed, enteredAt: Date.now() }));
  } catch {
    // Storage blocked: Continue just won't be offered next time.
  }
};
