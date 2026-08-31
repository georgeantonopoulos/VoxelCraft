import { CHUNK_SIZE_XZ } from '@/constants';

export const createTerrainHeightfieldArgs = (heights: Float32Array) => {
  const samplesPerAxis = CHUNK_SIZE_XZ + 1;
  const expectedSamples = samplesPerAxis * samplesPerAxis;
  if (heights.length !== expectedSamples) {
    throw new Error(`Invalid terrain heightfield: expected ${expectedSamples} samples, got ${heights.length}`);
  }

  // Rapier takes subdivision counts, while the height matrix contains one extra sample per axis.
  return [
    CHUNK_SIZE_XZ,
    CHUNK_SIZE_XZ,
    heights,
    { x: CHUNK_SIZE_XZ, y: 1, z: CHUNK_SIZE_XZ },
  ] as const;
};
