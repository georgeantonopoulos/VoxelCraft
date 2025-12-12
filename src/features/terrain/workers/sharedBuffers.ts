/**
 * SharedArrayBuffer helpers for chunk voxel data.
 *
 * Why:
 * - Remeshing currently posts `density/material` typed arrays from main -> worker frequently.
 * - Without transferables, this clones/copies large arrays and can hitch the main thread.
 * - With transferables, the main thread loses ownership of the buffers (not acceptable because
 *   gameplay code mutates and queries them).
 *
 * Using SharedArrayBuffer (when cross-origin isolated) lets both main and workers read the same
 * backing store without copies or ownership transfer.
 */

export const canUseSharedArrayBuffer = (): boolean => {
  // `crossOriginIsolated` exists in both Window and Worker contexts.
  // SharedArrayBuffer is only available in a cross-origin isolated context in modern browsers.
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as any).crossOriginIsolated === true;
};

export const isSharedArrayBuffer = (buf: unknown): boolean => {
  return typeof SharedArrayBuffer !== 'undefined' && buf instanceof SharedArrayBuffer;
};

export const toSharedFloat32Array = (src: Float32Array): Float32Array => {
  if (!canUseSharedArrayBuffer()) return src;
  const sab = new SharedArrayBuffer(src.byteLength);
  const out = new Float32Array(sab);
  out.set(src);
  return out;
};

export const toSharedUint8Array = (src: Uint8Array): Uint8Array => {
  if (!canUseSharedArrayBuffer()) return src;
  const sab = new SharedArrayBuffer(src.byteLength);
  const out = new Uint8Array(sab);
  out.set(src);
  return out;
};

export const toSharedVegetationBuckets = (
  buckets: Record<number, Float32Array>
): { vegetationData: Record<number, Float32Array>; vegetationBuffers: ArrayBuffer[] } => {
  const vegetationData: Record<number, Float32Array> = {};
  const vegetationBuffers: ArrayBuffer[] = [];

  for (const [k, arr] of Object.entries(buckets)) {
    const key = parseInt(k, 10);
    const shared = toSharedFloat32Array(arr);
    vegetationData[key] = shared;
    // Only transfer non-shared buffers; SharedArrayBuffer doesn't transfer ownership.
    if (!isSharedArrayBuffer(shared.buffer)) vegetationBuffers.push(shared.buffer);
  }

  return { vegetationData, vegetationBuffers };
};
