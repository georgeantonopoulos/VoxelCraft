
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

// Reordered for smoother transitions
export enum MaterialType {
  AIR = 0,
  BEDROCK = 1,
  STONE = 2,
  DIRT = 3,
  GRASS = 4,
  SAND = 5,
  SNOW = 6,
  CLAY = 7,
  WATER_SOURCE = 8,
  WATER_FLOWING = 9,
  MOSSY_STONE = 10
}

export interface MaterialProperties {
  absorptionRate: number; // How fast it gains wetness (0-255 scale per tick)
  dryingRate: number;     // How fast it loses wetness
  mossGrowthRate: number; // How fast mossiness increases if wet
  mossDecayRate: number;  // How fast mossiness decreases if dry
}

export interface ChunkData {
  id: string;
  density: Float32Array;
  material: Uint8Array; // Stores material ID per voxel
  wetness: Uint8Array;  // Stores wetness level (0-255)
  mossiness: Uint8Array; // Stores moss level (0-255)
  size: number;
  position: Vector3;
}

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  materials: Float32Array; // Attribute to pass to shader
  wetness: Float32Array;   // Attribute for wetness
  mossiness: Float32Array; // Attribute for mossiness
}

export enum ToolMode {
  DIG = 'DIG',
  BUILD = 'BUILD',
  PAINT = 'PAINT'
}
