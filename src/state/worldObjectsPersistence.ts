import { Quaternion, Vector3 } from 'three';
import { ItemType, type ActivePhysicsItem } from '@/types';
import { usePhysicsItemStore } from './PhysicsItemStore';
import { useWorldStore } from './WorldStore';
import { physicsItemBodies } from './physicsItemBodies';

/**
 * What the player leaves in a world: campfires, placed torches, planted flora
 * and dropped or thrown items. Saved per world (seed + type) where they lie now
 * and restored once the terrain is solid; before this they all vanished on
 * reload (a fire kept dry under a roof was simply gone).
 */
const PREFIX = 'vc-objects-v1-';

interface SavedEntity { id: string; type: ItemType.TORCH | ItemType.FLORA; p: [number, number, number]; q?: [number, number, number, number] }
interface SavedWorldObjects { items: ActivePhysicsItem[]; entities: SavedEntity[] }

export const worldObjectsKey = (type: string, seed: number) => `${PREFIX}${seed}:${type}`;

const livePosition = (item: ActivePhysicsItem): [number, number, number] => {
  const body = physicsItemBodies.get(item.id);
  try {
    if (body) { const t = body.translation(); return [t.x, t.y, t.z]; }
  } catch { /* body already removed from the physics world */ }
  return item.position;
};

const snapshot = (): SavedWorldObjects => {
  const items = usePhysicsItemStore.getState().items
    .map((it) => ({ ...it, position: livePosition(it), velocity: [0, 0, 0] as [number, number, number] }))
    .filter((it) => it.position[1] > -50);
  const entities: SavedEntity[] = [];
  for (const e of useWorldStore.getState().entities.values()) {
    if (e.type === ItemType.TORCH) {
      const q = e.rotation;
      entities.push({ id: e.id, type: ItemType.TORCH, p: [e.position.x, e.position.y, e.position.z], q: q ? [q.x, q.y, q.z, q.w] : undefined });
    } else if (e.type === ItemType.FLORA) {
      // Planted flora is a physics body: save where it settled.
      let p: [number, number, number] = [e.position.x, e.position.y, e.position.z];
      try {
        const t = e.bodyRef?.current?.translation?.();
        if (t) p = [t.x, t.y, t.z];
      } catch { /* body gone */ }
      entities.push({ id: e.id, type: ItemType.FLORA, p });
    }
  }
  return { items, entities };
};

let flushCurrent: (() => void) | null = null;

/** Save the bound world's objects now (call before stores are reset on leaving a world). */
export const flushWorldObjects = (): void => { flushCurrent?.(); };

/**
 * Restores the world's objects (call once the terrain colliders are ready) and
 * keeps them saved: on changes, every 8 s (items roll and settle without
 * touching the store) and on unload. Returns a cleanup that saves and stops.
 */
export const bindWorldObjects = (type: string, seed: number): (() => void) => {
  const key = worldObjectsKey(type, seed);
  try {
    const raw = window.localStorage.getItem(key);
    const saved = raw ? (JSON.parse(raw) as SavedWorldObjects) : null;
    if (saved) {
      const have = new Set(usePhysicsItemStore.getState().items.map((i) => i.id));
      const items = (saved.items ?? []).filter((i) => !have.has(i.id)).map((i) => ({ ...i, velocity: [0, 0, 0] as [number, number, number] }));
      if (items.length) usePhysicsItemStore.setState({ items: [...usePhysicsItemStore.getState().items, ...items] });
      const world = useWorldStore.getState();
      // A campfire is a physics item plus a world entity of the same id (rain and hollows look it up).
      for (const it of items) {
        if (it.type === ItemType.FIRE) world.addEntity({ id: it.id, type: ItemType.FIRE, position: new Vector3(...it.position) });
      }
      for (const e of saved.entities ?? []) {
        if (world.entities.has(e.id)) continue;
        if (e.type === ItemType.TORCH) {
          world.addEntity({ id: e.id, type: ItemType.TORCH, position: new Vector3(...e.p), rotation: e.q ? new Quaternion(...e.q) : undefined });
        } else if (e.type === ItemType.FLORA) {
          world.addEntity({ id: e.id, type: ItemType.FLORA, position: new Vector3(e.p[0], e.p[1] + 0.2, e.p[2]), bodyRef: { current: null } });
        }
      }
    }
  } catch { /* storage blocked or corrupt: start empty */ }

  let last = '';
  let closed = false;
  const save = () => {
    if (closed) return;
    const json = JSON.stringify(snapshot());
    if (json === last) return;
    last = json;
    try { window.localStorage.setItem(key, json); } catch { /* storage full or blocked */ }
  };
  let pending: ReturnType<typeof setTimeout> | null = null;
  const soon = () => { if (!pending) pending = setTimeout(() => { pending = null; save(); }, 1000); };
  const unsubItems = usePhysicsItemStore.subscribe(soon);
  const unsubWorld = useWorldStore.subscribe((s, prev) => { if (s.entities !== prev.entities) soon(); });
  const timer = window.setInterval(save, 8000);
  window.addEventListener('beforeunload', save);
  // Leaving the world: save now, then ignore the store resets that follow.
  const flush = () => { save(); closed = true; };
  flushCurrent = flush;
  return () => {
    unsubItems(); unsubWorld();
    if (pending) clearTimeout(pending);
    window.clearInterval(timer);
    window.removeEventListener('beforeunload', save);
    if (flushCurrent === flush) flushCurrent = null;
    save();
  };
};
