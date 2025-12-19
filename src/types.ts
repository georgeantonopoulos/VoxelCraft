
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
  matWeightsA: Float32Array; // Materials 0-3
  matWeightsB: Float32Array; // Materials 4-7
  matWeightsC: Float32Array; // Materials 8-11
  matWeightsD: Float32Array; // Materials 12-15
  wetness: Float32Array; // Attribute for wetness
  mossiness: Float32Array; // Attribute for mossiness
  cavity: Float32Array; // Attribute for baked micro-occlusion (creases/cavities)

  // Water Mesh Data
  waterPositions: Float32Array;
  waterIndices: Uint32Array;
  waterNormals: Float32Array;
  // Pre-computed shoreline SDF mask (CHUNK_SIZE_XZ x CHUNK_SIZE_XZ Uint8).
  // Computed in worker so main thread doesn't run the BFS.
  waterShoreMask: Uint8Array;

  // Simplified Physics Collider (Optional, used if trimesh is too heavy)
  colliderPositions?: Float32Array;
  colliderIndices?: Uint32Array;
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
  // Optional: if false, the chunk renders without a physics collider to reduce streaming hitches.
  // Collision can be enabled later when the chunk is near the player.
  colliderEnabled?: boolean;
  // Timestamp (seconds) when the chunk first became renderable.
  // Used for time-based fade-in to hide pop-in at render distance.
  spawnedAt?: number;
  density: Float32Array;
  material: Uint8Array;
  terrainVersion: number; // Triggers Physics Rebuild
  visualVersion: number;  // Triggers Visual Update Only

  meshPositions: Float32Array;
  meshIndices: Uint32Array;
  meshMatWeightsA: Float32Array;
  meshMatWeightsB: Float32Array;
  meshMatWeightsC: Float32Array;
  meshMatWeightsD: Float32Array;
  meshNormals: Float32Array;
  meshWetness: Float32Array;
  meshMossiness: Float32Array;
  meshCavity: Float32Array;

  floraPositions?: Float32Array;
  treePositions?: Float32Array;
  // Pre-computed instance matrices (worker-computed to avoid main-thread loops).
  // Key is "type:variant", value contains count and pre-built 4x4 matrices.
  treeInstanceBatches?: Record<string, { type: number; variant: number; count: number; matrices: Float32Array }>;
  rootHollowPositions?: Float32Array;
  fireflyPositions?: Float32Array; // stride 4: x, y, z, seed (WORLD SPACE)
  // Small ground pickups (chunk-local XZ, world-space Y). Stride is documented in `GroundItemsLayer.tsx`.
  stickPositions?: Float32Array;
  rockPositions?: Float32Array;
  drySticks?: Float32Array;
  jungleSticks?: Float32Array;
  rockDataBuckets?: Record<number, Float32Array>;
  // Non-pickup large rocks with collision. Stride is documented in `GroundItemsLayer.tsx`.
  largeRockPositions?: Float32Array;
  vegetationData?: Record<number, Float32Array>;

  meshWaterPositions: Float32Array;
  meshWaterIndices: Uint32Array;
  meshWaterNormals: Float32Array;
  // Pre-computed shoreline SDF mask (32x32 Uint8Array) — computed in worker to avoid main-thread BFS.
  meshWaterShoreMask?: Uint8Array;

  colliderPositions?: Float32Array;
  colliderIndices?: Uint32Array;

  lightPositions?: Float32Array;
}

export interface CustomTool {
  id: string;
  baseType: ItemType;
  attachments: Record<string, ItemType>; // slotId -> itemType
}

export enum ItemType {
  STONE = 'stone',
  STICK = 'stick',
  SHARD = 'shard',
  PICKAXE = 'pickaxe',
  FIRE = 'fire',
  FLORA = 'flora',
  TORCH = 'torch',
  AXE = 'axe'
}

export interface ActivePhysicsItem {
  id: string;
  type: ItemType;
  position: [number, number, number];
  velocity: [number, number, number];
  isPlanted?: boolean; // For sticks
  isAnchored?: boolean; // For stones near fire materials - prevents physics push
  heat?: number; // 0-10, for fire creation progress
}
