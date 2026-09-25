import { BiomeManager } from '@features/terrain/logic/BiomeManager';
import { hollowIdAt } from './groveEvents';

/**
 * Lumina Sense — finds the Keeper's next destination.
 *
 * Near range: exact Root Hollow positions from loaded chunk data (see
 * GroveDirector, which owns the ChunkDataManager dependency).
 * Long range: Sacred Grove centres sampled from the deterministic biome noise,
 * so the compass can guide the player toward hollows in chunks that have not
 * streamed in yet.
 */

export interface SenseHit {
  x: number;
  z: number;
  distSq: number;
  id?: string;
}

/**
 * Pick the nearest candidate from a packed stride-6 hollow buffer (chunk-local
 * XZ, world Y, normal). Pure helper so it can be unit tested.
 */
export const nearestInPacked = (
  packed: ArrayLike<number>,
  originX: number,
  originZ: number,
  px: number,
  pz: number,
  skip: (id: string) => boolean,
  best: SenseHit | null
): SenseHit | null => {
  let out = best;
  for (let i = 0; i + 5 < packed.length; i += 6) {
    const x = packed[i] + originX;
    const z = packed[i + 2] + originZ;
    const id = hollowIdAt(x, z);
    if (skip(id)) continue;
    const dx = x - px;
    const dz = z - pz;
    const d = dx * dx + dz * dz;
    if (!out || d < out.distSq) out = { x, z, distSq: d, id };
  }
  return out;
};

/**
 * Coarse scan for the nearest Sacred Grove centre. Samples rings outward and
 * stops at the first ring that contains a centre, so the typical cost is a few
 * hundred noise lookups — run it on a slow timer, never per frame.
 */
export const findNearestGroveCenter = (
  px: number,
  pz: number,
  maxRadius = 512,
  step = 24,
  exclude?: (x: number, z: number) => boolean
): SenseHit | null => {
  // Snap the scan grid to world space so results are stable as the player moves.
  const gx = Math.round(px / step) * step;
  const gz = Math.round(pz / step) * step;
  const rings = Math.ceil(maxRadius / step);
  for (let r = 1; r <= rings; r++) {
    let best: SenseHit | null = null;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        if (Math.abs(i) !== r && Math.abs(j) !== r) continue; // ring perimeter only
        const x = gx + i * step;
        const z = gz + j * step;
        const info = BiomeManager.getSacredGroveInfo(x, z);
        if (!info.isCenter) continue;
        if (exclude && exclude(x, z)) continue;
        const dx = x - px;
        const dz = z - pz;
        const d = dx * dx + dz * dz;
        if (!best || d < best.distSq) best = { x, z, distSq: d };
      }
    }
    if (best) return best;
  }
  return null;
};

/** Bearing (radians) from player to target, measured clockwise from world -Z. */
export const bearingTo = (px: number, pz: number, tx: number, tz: number): number =>
  Math.atan2(tx - px, -(tz - pz));
