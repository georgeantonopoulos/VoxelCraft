import type { World } from '@dimforge/rapier3d-compat';
import { TerrainService } from '@features/terrain/logic/terrainService';
import type { GroundAt } from './logic/support';

type RapierApi = { Ray: typeof import('@dimforge/rapier3d-compat').Ray };

/**
 * Ground height from the terrain colliders (so digs, builds, caves and
 * overhangs count), looking down from a little above `nearY`. Falls back to
 * the generated surface where no collider is loaded.
 */
export const makeGroundProbe = (world: World, rapier: RapierApi): GroundAt => (x, z, nearY) => {
  const from = nearY + 1.2;
  const hit = world.castRay(new rapier.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 6, true, undefined, undefined, undefined, undefined,
    (c: { parent: () => { userData?: unknown } | null }) => (c.parent()?.userData as { type?: string } | undefined)?.type === 'terrain');
  if (hit) return from - hit.timeOfImpact;
  const g = TerrainService.getHeightAt(x, z);
  return Number.isFinite(g) ? g : null;
};
