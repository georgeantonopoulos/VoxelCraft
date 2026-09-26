import { useInventoryStore, type SavedInventory } from './InventoryStore';

/**
 * Each world keeps its own inventory: entering a world loads what the player
 * carried there (a new world starts empty) and changes are saved back while
 * playing. Without this the store simply carried the last world's items into
 * the next one.
 */
const PREFIX = 'vc-inventory-v1-';

export const inventoryKey = (type: string, seed: number) => `${PREFIX}${seed}:${type}`;

const snapshot = (): SavedInventory => {
  const s = useInventoryStore.getState();
  return {
    inventoryCount: s.inventoryCount,
    torchCount: s.torchCount,
    stickCount: s.stickCount,
    stoneCount: s.stoneCount,
    shardCount: s.shardCount,
    luminousFloraCount: s.luminousFloraCount,
    hasPickaxe: s.hasPickaxe,
    hasAxe: s.hasAxe,
    customTools: s.customTools,
    customToolIds: s.customToolIds,
  };
};

/** Loads the world's inventory and keeps it saved; returns a cleanup that saves once more and stops. */
export const bindInventoryToWorld = (type: string, seed: number): (() => void) => {
  const key = inventoryKey(type, seed);
  let saved: SavedInventory | null = null;
  try {
    const raw = window.localStorage.getItem(key);
    saved = raw ? (JSON.parse(raw) as SavedInventory) : null;
  } catch { /* storage blocked or corrupt: start empty */ }
  useInventoryStore.getState().loadInventory(saved);

  let last = JSON.stringify(snapshot());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const json = JSON.stringify(snapshot());
    if (json === last) return;
    last = json;
    try { window.localStorage.setItem(key, json); } catch { /* storage full or blocked */ }
  };
  const unsubscribe = useInventoryStore.subscribe(() => {
    if (!timer) timer = setTimeout(save, 1000);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
    save();
  };
};
