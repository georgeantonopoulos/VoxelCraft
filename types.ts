
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
  SNOW = 6
}

export interface ChunkData {
  id: string;
  density: Float32Array;
  material: Uint8Array; // New: Stores material ID per voxel
  size: number;
  position: Vector3;
}

export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  materials: Float32Array; // New: Attribute to pass to shader
}

export enum ToolMode {
  DIG = 'DIG',
  BUILD = 'BUILD',
  PAINT = 'PAINT'
}
