
export enum BlockType {
  AIR = 0,
  BEDROCK = 1,
  STONE = 2,
  DIRT = 3,
  GRASS = 4,
  SAND = 5,
  SNOW = 6,
  WATER = 7,
  WOOD = 8,
  LEAF = 9,
  GLASS = 10
}

export type VoxelData = Uint8Array;

export interface GreedyMeshResult {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  uvs: Float32Array;
  textureIndices: Float32Array; // Layer index in DataArrayTexture
  ao: Float32Array; // Baked AO (0-3)

  // Separate mesh for transparent blocks (Water)
  transparentPositions: Float32Array;
  transparentIndices: Uint32Array;
  transparentNormals: Float32Array;
  transparentUvs: Float32Array;
  transparentTextureIndices: Float32Array;
  transparentAo: Float32Array;
}
