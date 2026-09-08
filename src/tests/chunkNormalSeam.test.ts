import { expect, it } from 'vitest';
import { generateMesh } from '@features/terrain/logic/mesher';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, CHUNK_SIZE_XZ } from '@/constants';
import { MaterialType } from '@/types';

it('matches normals at duplicated vertices across a curved chunk boundary', () => {
  const make = (offset: number) => {
    const density = new Float32Array(TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ);
    const material = new Uint8Array(density.length).fill(MaterialType.STONE);
    for (let z = 0; z < TOTAL_SIZE_XZ; z++) for (let y = 0; y < TOTAL_SIZE_Y; y++) for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
      const wx = x - PAD + offset, wz = z - PAD;
      density[x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y] = 55 + Math.sin(wx * .27) * 2 + Math.cos(wz * .19) - y;
    }
    return generateMesh(density, material);
  };
  const a = make(0), b = make(CHUNK_SIZE_XZ);
  const key = (p: Float32Array, i: number, offset: number) => [p[i] + offset, p[i + 1], p[i + 2]].map(v => v.toFixed(4)).join(',');
  const edge = new Map<string, number[]>();
  for (let i = 0; i < a.positions.length; i += 3) if (a.positions[i] > CHUNK_SIZE_XZ - 1) edge.set(key(a.positions, i, 0), Array.from(a.normals.slice(i, i + 3)));
  let matches = 0;
  for (let i = 0; i < b.positions.length; i += 3) {
    const normal = edge.get(key(b.positions, i, CHUNK_SIZE_XZ));
    if (!normal) continue;
    matches++;
    for (let c = 0; c < 3; c++) expect(b.normals[i + c]).toBeCloseTo(normal[c], 5);
  }
  expect(matches).toBeGreaterThan(20);
});
