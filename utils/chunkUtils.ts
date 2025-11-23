import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y } from '../constants';

const STRIDE_X = 1;
const STRIDE_Z = TOTAL_SIZE_XZ;
const STRIDE_Y = TOTAL_SIZE_XZ * TOTAL_SIZE_XZ;

export const to1D = (x: number, y: number, z: number): number => {
  return x * STRIDE_X + z * STRIDE_Z + y * STRIDE_Y;
};

export const to3D = (index: number): { x: number, y: number, z: number } => {
  const y = Math.floor(index / STRIDE_Y);
  const remY = index % STRIDE_Y;
  const z = Math.floor(remY / STRIDE_Z);
  const x = remY % STRIDE_Z;
  return { x, y, z };
};

export const getVoxel = (data: Uint8Array, x: number, y: number, z: number): number => {
    // Boundary checks can be added for safety, but omitted for perf in hot loops if sure
    if (x < 0 || x >= TOTAL_SIZE_XZ || z < 0 || z >= TOTAL_SIZE_XZ || y < 0 || y >= TOTAL_SIZE_Y) {
        return 0; // Air
    }
    return data[to1D(x, y, z)];
};

export const setVoxel = (data: Uint8Array, x: number, y: number, z: number, val: number) => {
    if (x >= 0 && x < TOTAL_SIZE_XZ && z >= 0 && z < TOTAL_SIZE_XZ && y >= 0 && y < TOTAL_SIZE_Y) {
        data[to1D(x, y, z)] = val;
    }
};
