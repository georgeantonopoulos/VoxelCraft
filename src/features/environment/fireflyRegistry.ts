/**
 * fireflyRegistry
 *
 * Ambient fireflies are generated during terrain generation (in the worker) and travel with chunks.
 * The renderer (AmbientLife) queries this registry for currently-loaded chunk fireflies near the player.
 *
 * This avoids the "regenerating" feel where fireflies change positions when the player crosses
 * a wrapping anchor grid; instead, they persist in world space and only appear/disappear with streaming.
 */

const chunkFireflies = new Map<string, Float32Array>();

// Bumped whenever chunk firefly data changes, so renderers can refresh without polling the map shape.
let version = 0;

export function setChunkFireflies(key: string, data: Float32Array | undefined) {
  if (!data || data.length === 0) {
    if (chunkFireflies.delete(key)) version++;
    return;
  }

  chunkFireflies.set(key, data);
  version++;
}

export function deleteChunkFireflies(key: string) {
  if (chunkFireflies.delete(key)) version++;
}

export function getFireflyRegistryVersion(): number {
  return version;
}

export function forEachChunkFireflies(cb: (key: string, data: Float32Array) => void) {
  chunkFireflies.forEach((data, key) => cb(key, data));
}

