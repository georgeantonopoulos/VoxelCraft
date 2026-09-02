import type { Ray, World } from '@dimforge/rapier3d-compat';
import { isTerrainCollider } from './raycastUtils';

type Point3 = { x: number; y: number; z: number };
type RayConstructor = new (origin: Point3, direction: Point3) => Ray;

const DEFAULT_SHARD_LIFT = 0.5;
const SHARD_GROUND_CLEARANCE = 0.3;
const PROBE_START_OFFSET = 1.0;
const PROBE_DISTANCE = 3.0;
const MAX_SURFACE_ABOVE_SOURCE = 0.75;

/**
 * Keeps newly-created shards clear of terrain even when their source rock is
 * partially embedded for visual grounding.
 */
export const getSafeShardSpawnPosition = (
  world: World,
  RayType: RayConstructor,
  position: Point3
): [number, number, number] => {
  const fallbackY = position.y + DEFAULT_SHARD_LIFT;
  const rayOrigin = { x: position.x, y: position.y + PROBE_START_OFFSET, z: position.z };
  const ray = new RayType(rayOrigin, { x: 0, y: -1, z: 0 });
  const hit = world.castRay(
    ray,
    PROBE_DISTANCE,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    isTerrainCollider
  );

  if (!hit) return [position.x, fallbackY, position.z];

  const surfaceY = rayOrigin.y - hit.timeOfImpact;
  if (surfaceY > position.y + MAX_SURFACE_ABOVE_SOURCE) {
    return [position.x, fallbackY, position.z];
  }

  return [
    position.x,
    Math.max(fallbackY, surfaceY + SHARD_GROUND_CLEARANCE),
    position.z,
  ];
};
