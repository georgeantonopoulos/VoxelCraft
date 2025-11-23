import { Vector3 } from 'three';
import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_Y, BEDROCK_LEVEL } from '../constants';
import { to1D } from './chunkUtils';
import { BlockType } from '../types';

const getBlockGlobal = (chunks: Record<string, any>, x: number, y: number, z: number): number => {
    const cx = Math.floor(x / CHUNK_SIZE_XZ);
    const cz = Math.floor(z / CHUNK_SIZE_XZ);
    const key = `${cx},${cz}`;
    const chunk = chunks[key];

    if (!chunk) return 0;

    const lx = x - cx * CHUNK_SIZE_XZ + PAD;
    const lz = z - cz * CHUNK_SIZE_XZ + PAD;
    const ly = y - BEDROCK_LEVEL + PAD;

    if (ly < 0 || ly >= TOTAL_SIZE_Y) return 0;

    return chunk.material[to1D(lx, ly, lz)];
};

export function raycastVoxel(start: Vector3, dir: Vector3, dist: number, chunks: Record<string, any>) {
  let t = 0.0;
  let ix = Math.floor(start.x);
  let iy = Math.floor(start.y);
  let iz = Math.floor(start.z);

  const stepX = (dir.x > 0) ? 1 : -1;
  const stepY = (dir.y > 0) ? 1 : -1;
  const stepZ = (dir.z > 0) ? 1 : -1;

  const txDelta = (dir.x === 0) ? Infinity : Math.abs(1 / dir.x);
  const tyDelta = (dir.y === 0) ? Infinity : Math.abs(1 / dir.y);
  const tzDelta = (dir.z === 0) ? Infinity : Math.abs(1 / dir.z);

  const xDist = (stepX > 0) ? (ix + 1 - start.x) : (start.x - ix);
  const yDist = (stepY > 0) ? (iy + 1 - start.y) : (start.y - iy);
  const zDist = (stepZ > 0) ? (iz + 1 - start.z) : (start.z - iz);

  let txMax = (txDelta < Infinity) ? txDelta * xDist : Infinity;
  let tyMax = (tyDelta < Infinity) ? tyDelta * yDist : Infinity;
  let tzMax = (tzDelta < Infinity) ? tzDelta * zDist : Infinity;

  let steppedIndex = -1;

  while (t <= dist) {
    const voxel = getBlockGlobal(chunks, ix, iy, iz);
    if (voxel !== BlockType.AIR && voxel !== BlockType.WATER) {
        return {
            position: [ix, iy, iz],
            normal: [
                steppedIndex === 0 ? -stepX : 0,
                steppedIndex === 1 ? -stepY : 0,
                steppedIndex === 2 ? -stepZ : 0
            ]
        };
    }

    if (txMax < tyMax) {
      if (txMax < tzMax) {
        ix += stepX; t = txMax; txMax += txDelta; steppedIndex = 0;
      } else {
        iz += stepZ; t = tzMax; tzMax += tzDelta; steppedIndex = 2;
      }
    } else {
      if (tyMax < tzMax) {
        iy += stepY; t = tyMax; tyMax += tyDelta; steppedIndex = 1;
      } else {
        iz += stepZ; t = tzMax; tzMax += tzDelta; steppedIndex = 2;
      }
    }
  }
  return null;
}
