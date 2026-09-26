import { CHUNK_SIZE_XZ } from '@/constants';
import { columnInfo, riverSignedAt, RIVER_WIDTH } from './terrainShape';

/**
 * River current for one chunk's water: a coarse grid (every 4 m, 9 x 9 over
 * the chunk) of flow direction and strength, sampled by the water shader.
 *
 * Rivers are the n = 0 lines of the signed river noise, so the flow runs along
 * the perpendicular of its gradient: continuous along a river and identical on
 * both sides of a chunk border (pure function of world position). Strength is
 * 1 in the channel and fades toward the valley rim; open sea has none.
 */
export const FLOW_GRID = 9;
export const FLOW_STEP = CHUNK_SIZE_XZ / (FLOW_GRID - 1);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Per grid point: flow direction x, z (unit) and strength 0..1; length FLOW_GRID^2 * 3. */
export function computeRiverFlow(cx: number, cz: number): Float32Array {
  const N = FLOW_GRID + 2; // one extra ring for the gradient
  const n = new Float32Array(N * N);
  const x0 = cx * CHUNK_SIZE_XZ, z0 = cz * CHUNK_SIZE_XZ;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const wx = x0 + (i - 1) * FLOW_STEP, wz = z0 + (j - 1) * FLOW_STEP;
      n[i + j * N] = riverSignedAt(wx, wz, columnInfo(wx, wz).warp);
    }
  }
  const out = new Float32Array(FLOW_GRID * FLOW_GRID * 3);
  for (let j = 0; j < FLOW_GRID; j++) {
    for (let i = 0; i < FLOW_GRID; i++) {
      const c = (i + 1) + (j + 1) * N;
      const gx = n[c + 1] - n[c - 1];
      const gz = n[c + N] - n[c - N];
      const len = Math.hypot(gx, gz);
      const o = (i + j * FLOW_GRID) * 3;
      if (len < 1e-9) continue;
      out[o] = -gz / len;
      out[o + 1] = gx / len;
      out[o + 2] = 1 - smoothstep(0.5, 1.0, Math.abs(n[c]) / RIVER_WIDTH);
    }
  }
  return out;
}
