import { ChunkMetadata, MetadataLayer } from '../types';
import { TOTAL_SIZE, CHUNK_SIZE } from '../constants';

export class MetadataDB {
  private chunks: Map<string, ChunkMetadata> = new Map();
  private defaultValues: Map<string, number> = new Map();

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
    return new Uint8Array(TOTAL_SIZE * TOTAL_SIZE * TOTAL_SIZE);
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
  getGlobal(wx: number, wy: number, wz: number, layer: string): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = `${cx},${cz}`;

    // Local coordinates within the chunk (including padding logic if we used padding in global coords)
    // Note: The system assumes standard "world space" to "chunk space" conversion.
    // wx, wz are absolute world coordinates.

    const lx = wx - (cx * CHUNK_SIZE);
    // y is global since we only chunk in X/Z (column chunks)?
    // Wait, VoxelTerrain.tsx uses "cx * CHUNK_SIZE".
    // However, the internal data arrays (TOTAL_SIZE) include padding (PAD = 2).
    // We need to map global coordinate to the specific index in the padded array.

    // The voxel at (wx, wy, wz) corresponds to:
    // index = (lx + PAD) + (ly + PAD) * SIZE + (lz + PAD) * SIZE * SIZE?
    // Wait, 'y' is vertical. 'TerrainService' uses:
    // wx = (x - PAD) + worldOffsetX => x = wx - worldOffsetX + PAD

    const localX = Math.floor(wx - cx * CHUNK_SIZE) + 2; // PAD
    const localY = Math.floor(wy) + 2; // PAD
    const localZ = Math.floor(wz - cz * CHUNK_SIZE) + 2; // PAD

    if (localY < 0 || localY >= TOTAL_SIZE) return this.defaultValues.get(layer) || 0;

    // Check bounds for X/Z just in case, though floor should handle it if we picked right chunk
    // But wait, if wx is exactly on border?
    // logic: cx = floor(wx / 32). wx = 31 -> cx=0. localX = 31 - 0 + 2 = 33.
    // wx = 32 -> cx=1. localX = 32 - 32 + 2 = 2.

    const idx = localX + localY * TOTAL_SIZE + localZ * TOTAL_SIZE * TOTAL_SIZE;

    return this.getValue(key, layer, idx);
  }
}

export const metadataDB = new MetadataDB();
