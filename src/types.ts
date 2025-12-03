
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

// Reordered for smoother transitions
// Updated for Water support and new Biomes
export enum MaterialType {
  AIR = 0,
  BEDROCK = 1,
  STONE = 2,
  DIRT = 3,
  GRASS = 4,
  SAND = 5,
  SNOW = 6,
  CLAY = 7,
  WATER = 8,
  MOSSY_STONE = 10,
  // New Biome Materials
  RED_SAND = 11,
  TERRACOTTA = 12,
  ICE = 13,
  JUNGLE_GRASS = 14,
  GLOW_STONE = 15,
  OBSIDIAN = 16
}

export interface MaterialProperties {
  absorptionRate: number; // How fast it gains wetness (0-255 scale per tick)
  dryingRate: number;     // How fast it loses wetness
  mossGrowthRate: number; // How fast mossiness increases if wet
  mossDecayRate: number;  // How fast mossiness decreases if dry
}

// Flexible Metadata Structure
export type MetadataLayer = Uint8Array;

export interface ChunkMetadata {
  [key: string]: MetadataLayer;
}

export interface ChunkData {
  id: string;
  density: Float32Array;
  material: Uint8Array; // Stores material ID per voxel
  metadata: ChunkMetadata; // Flexible metadata storage
  vegetationData?: Record<number, Float32Array>; // Ambient Vegetation
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  position: Vector3;
}

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  materialIndices: Uint8Array; // 4 component indices
  materialWeights: Float32Array; // 4 component weights
  wetness: Float32Array; // Attribute for wetness
  mossiness: Float32Array; // Attribute for mossiness

  // Water Mesh Data
  waterPositions: Float32Array;
  waterIndices: Uint32Array;
  waterNormals: Float32Array;
}

export enum ToolMode {
  DIG = 'DIG',
  BUILD = 'BUILD',
  PAINT = 'PAINT'
}

export type ChunkKey = string; // "x,z"

export interface ChunkState {
  key: ChunkKey;
  cx: number;
  cz: number;
  density: Float32Array;
  material: Uint8Array;
  terrainVersion: number; // Triggers Physics Rebuild
  visualVersion: number;  // Triggers Visual Update Only

  meshPositions: Float32Array;
  meshIndices: Uint32Array;
  meshMaterialIndices: Uint8Array;
  meshMaterialWeights: Float32Array;
  meshNormals: Float32Array;
  meshWetness: Float32Array;
  meshMossiness: Float32Array;

  floraPositions?: Float32Array;
  treePositions?: Float32Array;
  rootHollowPositions?: Float32Array;
  vegetationData?: Record<number, Float32Array>;

  meshWaterPositions: Float32Array;
  meshWaterIndices: Uint32Array;
  meshWaterNormals: Float32Array;
}
