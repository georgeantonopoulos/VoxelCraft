import type { World } from '@dimforge/rapier3d-compat';

/** The `rapier` namespace from useRapier (only its Ray constructor is used). */
type RapierApi = { Ray: typeof import('@dimforge/rapier3d-compat').Ray };

/**
 * Is there cover above this point? A roof of placed logs or planks, or rock
 * overhead (cave, overhang), within `reach` metres straight up. Tree crowns
 * do not count (they have no colliders and let rain through).
 */
export const isSheltered = (world: World, rapier: RapierApi, x: number, y: number, z: number, reach = 12): boolean => {
  const ray = new rapier.Ray({ x, y: y + 0.25, z }, { x: 0, y: 1, z: 0 });
  const hit = world.castRay(ray, reach, true, undefined, undefined, undefined, undefined,
    (c: { parent: () => { userData?: unknown } | null }) => {
      const t = (c.parent()?.userData as { type?: string } | undefined)?.type;
      return t === 'terrain' || t === 'log';
    });
  return !!hit;
};
