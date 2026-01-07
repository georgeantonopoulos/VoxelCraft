import { ChunkMetadata, MetadataLayer } from '@/types';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, CHUNK_SIZE_XZ, PAD, MESH_Y_OFFSET } from '@/constants';

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
    return new Uint8Array(TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ);
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
    const cx = Math.floor(wx / CHUNK_SIZE_XZ);
    const cz = Math.floor(wz / CHUNK_SIZE_XZ);
    const key = `${cx},${cz}`;

    const localX = Math.floor(wx - cx * CHUNK_SIZE_XZ) + PAD;
    // Map World Y to Grid Y: y = wy - OFFSET + PAD
    const localY = Math.floor(wy - MESH_Y_OFFSET) + PAD;
    const localZ = Math.floor(wz - cz * CHUNK_SIZE_XZ) + PAD;

    if (localY < 0 || localY >= TOTAL_SIZE_Y) return this.defaultValues.get(layer) || 0;
    if (localX < 0 || localX >= TOTAL_SIZE_XZ) return this.defaultValues.get(layer) || 0;
    if (localZ < 0 || localZ >= TOTAL_SIZE_XZ) return this.defaultValues.get(layer) || 0;

    const idx = localX + localY * TOTAL_SIZE_XZ + localZ * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

    return this.getValue(key, layer, idx);
  }
}

export const metadataDB = new MetadataDB();
