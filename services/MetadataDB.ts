import { ChunkMetadata, MetadataLayer } from '../types';
import { TOTAL_SIZE, TOTAL_HEIGHT, CHUNK_SIZE, PAD, BEDROCK_LEVEL } from '../constants';

export class MetadataDB {
  private chunks: Map<string, ChunkMetadata> = new Map();
  private defaultValues: Map<string, number> = new Map();
  private MESH_Y_OFFSET = -33; // Must match VoxelTerrain and TerrainService logic

  constructor() {
    // Register default layers and their default values
    this.defaultValues.set('wetness', 0);
    this.defaultValues.set('mossiness', 0);
  }

  // Initialize a chunk in the DB
  initChunk(key: string, metadata: ChunkMetadata) {
    this.chunks.set(key, metadata);
  }

  // Register a new layer type if needed dynamically
  registerLayer(name: string, defaultValue: number = 0) {
    this.defaultValues.set(name, defaultValue);
  }

  getChunk(key: string): ChunkMetadata | undefined {
    return this.chunks.get(key);
  }

  // Create a new empty layer
  createLayer(): MetadataLayer {
    return new Uint8Array(TOTAL_SIZE * TOTAL_HEIGHT * TOTAL_SIZE);
  }

  // Get value from a specific chunk
  getValue(key: string, layer: string, index: number): number {
    const chunk = this.chunks.get(key);
    if (!chunk || !chunk[layer]) return this.defaultValues.get(layer) || 0;
    return chunk[layer][index];
  }

  // Set value in a specific chunk
  setValue(key: string, layer: string, index: number, value: number) {
    const chunk = this.chunks.get(key);
    if (chunk && chunk[layer]) {
      chunk[layer][index] = value;
    }
  }

  // Global coordinate lookup (handles neighbors)
  // Returns the value and whether it was found
  // wx, wy, wz are World Coordinates (where player is)
  getGlobal(wx: number, wy: number, wz: number, layer: string): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = `${cx},${cz}`;

    // Convert World Coordinate to Local Array Coordinate
    // World X = (x - PAD) + cx*SIZE => x = WorldX - cx*SIZE + PAD
    const localX = Math.floor(wx - cx * CHUNK_SIZE) + PAD;

    // World Y. Mesh is offset by MESH_Y_OFFSET (-33).
    // Array index y corresponds to world Y = (y - PAD) + MESH_Y_OFFSET
    // So y = WorldY - MESH_Y_OFFSET + PAD
    const localY = Math.floor(wy - this.MESH_Y_OFFSET) + PAD;

    const localZ = Math.floor(wz - cz * CHUNK_SIZE) + PAD;

    if (localY < 0 || localY >= TOTAL_HEIGHT) return this.defaultValues.get(layer) || 0;
    if (localX < 0 || localX >= TOTAL_SIZE) return this.defaultValues.get(layer) || 0;
    if (localZ < 0 || localZ >= TOTAL_SIZE) return this.defaultValues.get(layer) || 0;

    const idx = localX + localY * TOTAL_SIZE + localZ * TOTAL_SIZE * TOTAL_HEIGHT;
    // Wait, index logic in TerrainService is:
    // x + y * sizeXZ + z * sizeXZ * sizeY
    const realIdx = localX + localY * TOTAL_SIZE + localZ * TOTAL_SIZE * TOTAL_HEIGHT;

    return this.getValue(key, layer, realIdx);
  }
}

export const metadataDB = new MetadataDB();
