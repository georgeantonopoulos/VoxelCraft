import { WorldType } from '@features/terrain/logic/BiomeManager';

/**
 * Every world the player has entered, so the title screen can list them to
 * continue or let one go. A world is its (type, seed): terrain edits live in
 * IndexedDB under `<seed>:<type>:g<GEN>|...`, Grove progress and placed logs in
 * localStorage per seed. This list is only the index over that data.
 */
export interface SavedWorld {
  type: WorldType;
  seed: number;
  name: string;
  createdAt: number;
  lastPlayed: number;
}

const KEY = 'vc-worlds-v1';
/** The single "last world" record this list replaced; migrated on first read. */
const LEGACY_KEY = 'vc-last-world-v1';

const FIRST = ['Moss', 'Ash', 'Fern', 'Hollow', 'Still', 'Thorn', 'Dusk', 'Lichen', 'Alder', 'Wren', 'Mire', 'Rowan', 'Ember', 'Hazel', 'Sorrow', 'Willow'];
const SECOND = ['mere', 'fall', 'vale', 'wood', 'hollow', 'brook', 'reach', 'glade', 'moor', 'dell', 'combe', 'weald', 'holt', 'ford', 'deep', 'shaw'];

/** A quiet place name derived from the seed (stable: the same seed always gets the same name). */
export const worldNameFor = (seed: number): string => {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const a = FIRST[h % FIRST.length];
  let b = SECOND[(h >>> 8) % SECOND.length];
  // Avoid doubled words ("Hollowhollow").
  if (a.toLowerCase() === b) b = SECOND[((h >>> 8) + 1) % SECOND.length];
  return a + b;
};

const isWorldType = (t: unknown): t is WorldType =>
  typeof t === 'string' && (Object.values(WorldType) as string[]).includes(t);

const sameWorld = (a: { type: WorldType; seed: number }, type: WorldType, seed: number) =>
  a.type === type && a.seed === seed;

const readRaw = (): SavedWorld[] => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedWorld>[];
      if (Array.isArray(parsed)) {
        return parsed
          .filter((w) => w && isWorldType(w.type) && typeof w.seed === 'number' && w.seed > 0)
          .map((w) => ({
            type: w.type as WorldType,
            seed: w.seed as number,
            name: typeof w.name === 'string' && w.name ? w.name : worldNameFor(w.seed as number),
            createdAt: w.createdAt ?? 0,
            lastPlayed: w.lastPlayed ?? 0,
          }));
      }
    }
    // First run with this list: carry over the old single last-world record.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const w = JSON.parse(legacy) as { type?: unknown; seed?: unknown; enteredAt?: number };
      if (isWorldType(w.type) && typeof w.seed === 'number' && w.seed > 0) {
        const at = w.enteredAt ?? Date.now();
        const list = [{ type: w.type, seed: w.seed, name: worldNameFor(w.seed), createdAt: at, lastPlayed: at }];
        writeRaw(list);
        return list;
      }
    }
  } catch {
    // Storage blocked or corrupt: no saved worlds offered.
  }
  return [];
};

const writeRaw = (list: SavedWorld[]): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the list just won't survive a reload.
  }
};

/** Saved worlds, most recently played first. */
export const listWorlds = (): SavedWorld[] => readRaw().sort((a, b) => b.lastPlayed - a.lastPlayed);

/** Call when a world is entered: adds it to the list or marks it as just played. */
export const recordWorldEntered = (type: WorldType, seed: number): void => {
  const list = readRaw();
  const now = Date.now();
  const found = list.find((w) => sameWorld(w, type, seed));
  if (found) found.lastPlayed = now;
  else list.push({ type, seed, name: worldNameFor(seed), createdAt: now, lastPlayed: now });
  writeRaw(list);
};

/**
 * Let a world go: removes it from the list and erases what was saved for it
 * (terrain edits and inventory for this type+seed; Grove progress and builds for the seed,
 * unless another listed world shares that seed).
 */
export const forgetWorld = async (type: WorldType, seed: number): Promise<void> => {
  const rest = readRaw().filter((w) => !sameWorld(w, type, seed));
  writeRaw(rest);
  if (!rest.some((w) => w.seed === seed)) {
    try {
      window.localStorage.removeItem(`vc-grove-v1-${seed}`);
      window.localStorage.removeItem(`vc-logs-v1-${seed}`);
    } catch { /* storage blocked */ }
  }
  try {
    window.localStorage.removeItem(`vc-inventory-v1-${seed}:${type}`);
    window.localStorage.removeItem(`vc-objects-v1-${seed}:${type}`);
  } catch { /* storage blocked */ }
  try {
    const { worldDB } = await import('./WorldDB');
    // Chunk ids are `<seed>:<type>:g<GEN>|cx,cz`: every generator version of this world.
    const prefix = `${seed}:${type}:`;
    await worldDB.modifications.where('chunkId').startsWith(prefix).delete();
    await worldDB.groundPickups.where('chunkId').startsWith(prefix).delete();
  } catch {
    // IndexedDB unavailable: the world is off the list; stale rows are harmless.
  }
};

/** "just now", "3 hours ago", "2 days ago" for the world list. */
export const playedAgo = (at: number, now: number = Date.now()): string => {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} minutes ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  const d = h / 24;
  if (d < 14) return `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} ago`;
  const w = d / 7;
  if (w < 9) return `${Math.round(w)} weeks ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
