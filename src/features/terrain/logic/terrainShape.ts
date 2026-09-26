import { noise as noise3D } from '@core/math/noise';
import { WATER_LEVEL, CHUNK_SIZE_Y, MESH_Y_OFFSET } from '@/constants';
import { BiomeManager } from './BiomeManager';

/**
 * Column surface shape: the single source of truth for terrain height.
 * Used by TerrainService.generateChunk (density) and TerrainService.getHeightAt
 * (placement, spawns, creatures), so the two can never drift apart.
 *
 * Layers, from large to small:
 *  1. Domain-warped 3-octave fBm for rolling land forms (first octave = legacy shape).
 *  2. Ridged multifractal with a detail-damping cascade in mountains (erosion > ~0.5):
 *     sharp crests, smooth valleys, the classic eroded look.
 *  3. Soft terraces (mesas, stepped badlands) in arid, rugged terrain.
 *  4. Meandering river valleys cut into land (|noise| ~ 0 lines), bed below sea level.
 *  5. Fine surface roughness.
 */

/** Overhang noise fades out this far above the column surface (no floating islands). */
export const OVERHANG_FADE_ABOVE = 5;

/**
 * Overhang contribution at height wy. Above the surface it fades to zero within
 * OVERHANG_FADE_ABOVE metres, so noise can shape ledges and overhangs attached
 * to the ground but never lift detached blobs of rock into the air.
 */
export function overhangFade(wy: number, surface: number): number {
  const t = (wy - surface) / OVERHANG_FADE_ABOVE;
  return t <= 0 ? 1 : t >= 1 ? 0 : 1 - t;
}

/** Upper bound for the surface so overhang noise stays inside the chunk column. */
export const MAX_SURFACE_Y = MESH_Y_OFFSET + (CHUNK_SIZE_Y - 1) - 7;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface ColumnShapeInput {
  baseHeight: number;
  amp: number;
  freq: number;
  warp: number;
  /** Climate erosion, -1 (sediment/flat) .. 1 (eroded peaks). */
  erosion: number;
  /** Climate temperature (-1..1). */
  temp: number;
  /** Climate humidity (-1..1). */
  humid: number;
}

/** Terrace step height (m) for mesas. */
const TERRACE_STEP = 4.5;
/** River noise frequency (1/m): meander wavelength ~ 600 m. */
const RIVER_FREQ = 0.0016;
/** |noise| below this is river valley. Wider band = wider valleys. */
const RIVER_WIDTH = 0.075;
const RIVER_BED = WATER_LEVEL - 2.5;

/** Unclamped surface height for a column. */
export function shapeColumnHeight(wx: number, wz: number, p: ColumnShapeInput): number {
  const qx = noise3D(wx * 0.008, 0, wz * 0.008) * p.warp;
  const qz = noise3D(wx * 0.008 + 5.2, 0, wz * 0.008 + 1.3) * p.warp;
  const px = wx + qx;
  const pz = wz + qz;
  const f = 0.01 * p.freq;

  // 1. Rolling forms.
  let base = noise3D(px * f, 0, pz * f);
  base += 0.38 * noise3D(px * f * 2.03 + 17.1, 0, pz * f * 2.03 - 9.4);
  base += 0.16 * noise3D(px * f * 4.11 - 3.3, 0, pz * f * 4.11 + 21.7);
  base /= 1.3;

  // 2. Eroded mountains.
  const e = clamp01((p.erosion + 1) * 0.5);
  const m = smoothstep(0.55, 0.85, e) * smoothstep(8, 22, p.amp);
  let shape = base;
  if (m > 0.001) {
    let sum = 0, norm = 0, a = 0.5, weight = 1, fr = f * 1.4;
    for (let o = 0; o < 4; o++) {
      // Soft |x|: keeps crests sharp at a distance but rounds the cusp (a hard
      // abs() made metre-scale knife edges up to ~8 m/m).
      const rn = noise3D(px * fr + o * 31.7, 0.37, pz * fr - o * 11.3);
      let n = 1 - Math.sqrt(rn * rn + 0.006);
      n *= n;
      // Detail is damped where the previous octave was low (valleys stay smooth).
      n *= weight;
      weight = clamp01(n * 2.2);
      sum += n * a;
      norm += a;
      a *= 0.5;
      fr *= 2.07;
    }
    const ridge = sum / norm; // 0..1, crests near 1
    shape = base * (1 - m * 0.85) + (ridge * 2.1 - 0.55) * m * 0.85;
  }

  let h = p.baseHeight + shape * p.amp;

  // 5 (applied before terraces so steps stay crisp). Fine roughness, scaled by relief.
  h += (noise3D(px * 0.05, 0, pz * 0.05) * 0.1 + noise3D(px * 0.13 + 7.1, 0, pz * 0.13 - 2.9) * 0.035) * p.amp;
  h += noise3D(px * 0.23 + 3.3, 0, pz * 0.23 + 8.8) * 0.3;

  // 3. Terraces in hot, dry, rugged land.
  const aridity = smoothstep(0.1, 0.55, p.temp) * smoothstep(0.1, -0.45, p.humid);
  const t = aridity * smoothstep(5, 16, p.amp);
  if (t > 0.01) {
    const q = h / TERRACE_STEP;
    const fl = Math.floor(q);
    const stepped = (fl + smoothstep(0.3, 0.7, q - fl)) * TERRACE_STEP;
    h += (stepped - h) * t * 0.9;
  }

  // 4. River valleys: the channel always reaches below sea level (the water
  // post-pass fills it), so rivers run wet all the way to the coast. In
  // mountains the valley narrows into a gorge instead of a broad trench.
  const rv = Math.abs(noise3D(wx * RIVER_FREQ + qx * 0.0015, 7.7, wz * RIVER_FREQ + qz * 0.0015));
  const width = RIVER_WIDTH * (1 - 0.2 * m);
  if (rv < width && h > RIVER_BED) {
    const x = rv / width; // 0 at the channel centre, 1 at the valley rim
    const bank = Math.pow(1 - smoothstep(0.0, 1.0, x), 1.6); // rounded U valley
    h -= (h - RIVER_BED) * bank;
  }

  return h;
}

/** Everything the chunk generator needs about a column. */
export interface ColumnInfo {
  height: number;
  climate: { temp: number; humid: number; continent: number; erosion: number };
  groveMod: ReturnType<typeof BiomeManager.getSacredGroveTerrainMod>;
  warp: number;
  amp: number;
}

/** Climate -> parameters -> Sacred Grove flattening -> clamped surface height. */
export function columnInfo(wx: number, wz: number): ColumnInfo {
  const climate = BiomeManager.getClimate(wx, wz);
  const params = BiomeManager.getTerrainParametersFromMetrics(climate.temp, climate.humid, climate.continent, climate.erosion);
  const groveMod = BiomeManager.getSacredGroveTerrainMod(wx, wz);
  const amp = params.amp * groveMod.ampMultiplier;
  const warp = params.warp * groveMod.warpMultiplier;
  const height = Math.min(
    MAX_SURFACE_Y,
    shapeColumnHeight(wx, wz, {
      baseHeight: params.baseHeight, amp, freq: params.freq, warp,
      erosion: climate.erosion, temp: climate.temp, humid: climate.humid,
    })
  );
  return { height, climate, groveMod, warp, amp };
}

// Biome lookups place beaches by the real water line (BiomeManager cannot import this module).
BiomeManager.setSurfaceHeightProvider((x, z) => columnInfo(x, z).height);
