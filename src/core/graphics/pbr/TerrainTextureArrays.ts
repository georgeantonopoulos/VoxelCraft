import * as THREE from 'three';
import {
  PBR_LAYER_COUNT,
  PBR_SYNTH_VERSION,
  PBR_TEXTURE_SIZE,
  PBR_TILE_METERS,
} from './textureSynth';

/**
 * Terrain PBR texture arrays (one layer per material channel).
 *
 * - `albedoHeight`: sRGB albedo + linear height in alpha.
 * - `normalRoughAO`: tangent normal XY, roughness, ambient occlusion (linear).
 *
 * Both start as flat palette colours so the terrain renders immediately. Layers
 * are synthesised in workers (terrainTextures.worker.ts), cached in IndexedDB
 * by PBR_SYNTH_VERSION, and uploaded one layer at a time as they arrive.
 */

const SIZE = PBR_TEXTURE_SIZE;
const LAYER_BYTES = SIZE * SIZE * 4;
const DB_NAME = 'vc-terrain-textures';
const STORE = 'layers';

/** Flat placeholder albedo per channel (sRGB), matching the old palette. */
const PLACEHOLDER: readonly string[] = [
  '#888c8d', '#2c2c30', '#8a8c8a', '#6b4a32', '#4a8a2c', '#dcc896', '#f4f7fb', '#a8795a',
  '#1a5a8a', '#667a4a', '#c8663e', '#a4583c', '#bfe3f7', '#27602a', '#1e2226', '#0c0a12',
];

function makeArray(data: Uint8Array, srgb: boolean): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, PBR_LAYER_COUNT);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function fillPlaceholders(a: Uint8Array, b: Uint8Array) {
  const c = new THREE.Color();
  for (let layer = 0; layer < PBR_LAYER_COUNT; layer++) {
    c.set(PLACEHOLDER[layer]);
    const r = Math.round(c.r * 255), g = Math.round(c.g * 255), bl = Math.round(c.b * 255);
    const base = layer * LAYER_BYTES;
    for (let i = 0; i < LAYER_BYTES; i += 4) {
      a[base + i] = r; a[base + i + 1] = g; a[base + i + 2] = bl; a[base + i + 3] = 128;
      b[base + i] = 128; b[base + i + 1] = 128; b[base + i + 2] = 230; b[base + i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// IndexedDB cache (best effort: failures just mean re-synthesising)
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const cacheKey = (layer: number) => `v${PBR_SYNTH_VERSION}-s${SIZE}-l${layer}`;

function readCached(db: IDBDatabase, layer: number): Promise<{ a: Uint8Array; b: Uint8Array } | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(cacheKey(layer));
      req.onsuccess = () => {
        const v = req.result as { a?: Uint8Array; b?: Uint8Array } | undefined;
        resolve(v?.a?.length === LAYER_BYTES && v?.b?.length === LAYER_BYTES ? { a: v.a, b: v.b } : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeCached(db: IDBDatabase, layer: number, a: Uint8Array, b: Uint8Array) {
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ a, b }, cacheKey(layer));
  } catch {
    /* ignore quota / private mode */
  }
}

// ---------------------------------------------------------------------------

export interface TerrainTextureArrays {
  albedoHeight: THREE.DataArrayTexture;
  normalRoughAO: THREE.DataArrayTexture;
  /** 1 / tile size in metres, per layer (shader uniform). */
  scales: number[];
  /** Resolves when every layer is synthesised (or loaded from cache) and uploaded. */
  ready: Promise<void>;
}

let instance: TerrainTextureArrays | null = null;

/** Lazily creates the shared texture arrays and starts filling them. */
export function getTerrainTextureArrays(): TerrainTextureArrays {
  if (instance) return instance;
  const dataA = new Uint8Array(LAYER_BYTES * PBR_LAYER_COUNT);
  const dataB = new Uint8Array(LAYER_BYTES * PBR_LAYER_COUNT);
  fillPlaceholders(dataA, dataB);
  const albedoHeight = makeArray(dataA, true);
  const normalRoughAO = makeArray(dataB, false);
  const scales = PBR_TILE_METERS.map((m) => 1 / m);

  const upload = (layer: number, a: Uint8Array, b: Uint8Array) => {
    dataA.set(a, layer * LAYER_BYTES);
    dataB.set(b, layer * LAYER_BYTES);
    albedoHeight.addLayerUpdate(layer);
    normalRoughAO.addLayerUpdate(layer);
    albedoHeight.needsUpdate = true;
    normalRoughAO.needsUpdate = true;
  };

  const ready = (async () => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return;
    const db = await openDb();
    const missing: number[] = [];
    for (let layer = 0; layer < PBR_LAYER_COUNT; layer++) {
      const cached = db ? await readCached(db, layer) : null;
      if (cached) upload(layer, cached.a, cached.b);
      else missing.push(layer);
    }
    if (missing.length === 0) return;

    // Round-robin split across a few workers.
    const workerCount = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1, missing.length));
    const buckets: number[][] = Array.from({ length: workerCount }, () => []);
    missing.forEach((layer, i) => buckets[i % workerCount].push(layer));
    await Promise.all(buckets.map((layers) => new Promise<void>((resolve) => {
      const worker = new Worker(new URL('./terrainTextures.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ type: string; layer?: number; a?: Uint8Array; b?: Uint8Array }>) => {
        const msg = e.data;
        if (msg.type === 'LAYER' && msg.layer !== undefined && msg.a && msg.b) {
          upload(msg.layer, msg.a, msg.b);
          if (db) writeCached(db, msg.layer, msg.a, msg.b);
        } else if (msg.type === 'DONE') {
          worker.terminate();
          resolve();
        }
      };
      worker.onerror = () => { worker.terminate(); resolve(); };
      worker.postMessage({ layers, size: SIZE });
    })));
  })();

  instance = { albedoHeight, normalRoughAO, scales, ready };
  return instance;
}
