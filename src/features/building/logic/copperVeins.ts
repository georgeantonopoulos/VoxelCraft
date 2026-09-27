import { noise } from '@core/math/noise';
import { MaterialType } from '@/types';

/**
 * Native copper, hidden in the rock. Veins are thin winding sheets (the zero
 * set of a stretched 3D noise field, like cracks that mineral water filled)
 * and only exist a few metres below the surface, so they are found by
 * digging, never seen from above. Digging through vein rock knocks nuggets
 * out; rock close to a vein shows copper-green flecks in its chips, a hint to
 * keep digging that way. Pure function of world position and seed (the
 * noise permutation is seeded per world in App).
 */

/** Rock that can carry copper. */
export const COPPER_ROCK = new Set<MaterialType>([
  MaterialType.STONE, MaterialType.MOSSY_STONE, MaterialType.TERRACOTTA,
]);

/** How deep under the column surface veins begin (m). */
export const VEIN_MIN_DEPTH = 2.5;

/** 0 far from a vein .. 1 on its centre sheet. */
export const veinStrength = (x: number, y: number, z: number): number => {
  // Stretched sideways: veins run more along the ground than up and down.
  const n = noise(x * 0.07 + 311.7, y * 0.13 - 57.3, z * 0.07 + 91.1);
  // Second field breaks sheets into patches (not endless planes).
  const patch = noise(x * 0.03 - 17.9, y * 0.03 + 203.1, z * 0.03 + 44.4);
  const ridge = 1 - Math.min(1, Math.abs(n) / 0.12);
  return patch > -0.05 ? ridge : 0;
};

/** Offsets sampled around a dig (a strike breaks out a fist-sized volume, not a point). */
const DIG_SAMPLES: [number, number, number][] = [
  [0, 0, 0], [0.7, 0, 0], [-0.7, 0, 0], [0, 0.7, 0], [0, -0.7, 0], [0, 0, 0.7], [0, 0, -0.7],
];

/** Strongest vein within a dig at (x, y, z). */
export const veinStrengthInDig = (x: number, y: number, z: number): number => {
  let v = 0;
  for (const [dx, dy, dz] of DIG_SAMPLES) v = Math.max(v, veinStrength(x + dx, y + dy, z + dz));
  return v;
};

export type CopperFind = 'none' | 'trace' | 'nugget';

/**
 * What a dig at (x, y, z) in `material` turns up. `roll` is a uniform random
 * number (a vein does not give a nugget on every strike).
 */
export const copperFind = (x: number, y: number, z: number, material: MaterialType, surfaceY: number, roll: number): CopperFind => {
  if (!COPPER_ROCK.has(material) || y > surfaceY - VEIN_MIN_DEPTH) return 'none';
  const v = veinStrengthInDig(x, y, z);
  if (v > 0.7 && roll < 0.65) return 'nugget';
  if (v > 0) return 'trace';
  return 'none';
};

/** Colour of a nugget and of the flecks in vein rock. */
export const COPPER_COLOR = '#c47a45';
export const COPPER_TRACE_COLOR = '#5f9a82';
