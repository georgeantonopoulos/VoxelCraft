import { canUseSharedArrayBuffer } from './sharedBuffers';

export type TerrainWorkersMode = 'pipeline' | 'legacy';

export type TerrainWorkersEvents = {
  // Base voxel + placement data is ready. Mesh will arrive separately in pipeline mode.
  onGeneratedBase: (payload: any) => void;
  // Mesh buffers are ready (for both chunk generation and remesh).
  onMeshDone: (payload: any) => void;
  // Legacy worker still emits these combined events.
  onLegacyGenerated?: (payload: any) => void;
  onLegacyRemeshed?: (payload: any) => void;
};

/**
 * Terrain worker bridge.
 *
 * - Pipeline mode (preferred): generation worker + mesher worker.
 *   Uses SharedArrayBuffer when cross-origin isolated to avoid cloning large voxel fields.
 *
 * - Legacy mode (fallback): existing `terrain.worker.ts` that generates + meshes in one worker.
 *   Used when SharedArrayBuffer isn't available (e.g. missing COOP/COEP headers).
 */
export class TerrainWorkers {
  readonly mode: TerrainWorkersMode;
  private terrainGen?: Worker;
  private mesher?: Worker;
  private legacy?: Worker;

  constructor(private events: TerrainWorkersEvents) {
    // We only enable the two-worker pipeline when SharedArrayBuffer is usable.
    // Otherwise, keep the old single-worker behavior to avoid main-thread cloning/copying.
    this.mode = canUseSharedArrayBuffer() ? 'pipeline' : 'legacy';
  }

  start(worldType: string) {
    if (this.mode === 'pipeline') {
      this.terrainGen = new Worker(new URL('./terrainGen.worker.ts', import.meta.url), { type: 'module' });
      this.mesher = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' });

      this.terrainGen.postMessage({ type: 'CONFIGURE', payload: { worldType } });

      this.terrainGen.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'GENERATED_BASE') this.events.onGeneratedBase(payload);
      };

      this.mesher.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'MESH_DONE') this.events.onMeshDone(payload);
      };

      return;
    }

    // Legacy fallback (existing combined worker).
    this.legacy = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    this.legacy.postMessage({ type: 'CONFIGURE', payload: { worldType } });
    this.legacy.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'GENERATED') this.events.onLegacyGenerated?.(payload);
      if (type === 'REMESHED') this.events.onLegacyRemeshed?.(payload);
    };
  }

  generate(cx: number, cz: number) {
    if (this.mode === 'pipeline') {
      this.terrainGen?.postMessage({ type: 'GENERATE', payload: { cx, cz } });
      return;
    }
    this.legacy?.postMessage({ type: 'GENERATE', payload: { cx, cz } });
  }

  meshGenerate(key: string, density: Float32Array, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array) {
    if (this.mode === 'pipeline') {
      this.mesher?.postMessage({
        type: 'MESH_GENERATE',
        payload: { key, density, material, wetness, mossiness }
      });
      return;
    }
    // In legacy mode meshing happens during GENERATE.
  }

  remesh(
    key: string,
    cx: number,
    cz: number,
    density: Float32Array,
    material: Uint8Array,
    wetness: Uint8Array,
    mossiness: Uint8Array,
    version?: number
  ) {
    if (this.mode === 'pipeline') {
      this.mesher?.postMessage({
        type: 'MESH_REMESH',
        payload: { key, density, material, wetness, mossiness }
      });
      return;
    }
    this.legacy?.postMessage({
      type: 'REMESH',
      // Legacy worker uses cx/cz/version mostly for debugging/tracking.
      payload: { key, cx, cz, version, density, material, wetness, mossiness }
    });
  }

  terminate() {
    this.terrainGen?.terminate();
    this.mesher?.terminate();
    this.legacy?.terminate();
  }
}
