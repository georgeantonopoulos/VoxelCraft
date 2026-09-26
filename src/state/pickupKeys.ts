/**
 * Stable record keys for persisted removals of generated objects.
 *
 * Trees are removed by compacting treePositions, so array indices shift and
 * cannot identify a tree across reloads. Trees are keyed by their chunk-local
 * position instead (1/16 voxel precision; locals range about -8..40).
 */
export const treeRecordIndex = (localX: number, localZ: number): number =>
  (Math.round((localX + 8) * 16) << 16) | Math.round((localZ + 8) * 16);

/** Remove trees whose record keys are in `removed` (stride 5: x, y, z, type, scale). */
export const filterRemovedTrees = (treePositions: Float32Array, removed: ReadonlySet<number>): Float32Array => {
  if (removed.size === 0) return treePositions;
  const kept: number[] = [];
  for (let i = 0; i < treePositions.length; i += 5) {
    if (removed.has(treeRecordIndex(treePositions[i], treePositions[i + 2]))) continue;
    for (let k = 0; k < 5; k++) kept.push(treePositions[i + k]);
  }
  return kept.length === treePositions.length ? treePositions : new Float32Array(kept);
};

/** The entries (stride 5) of trees whose record keys are in `removed`: where their stumps stand. */
export const removedTreeEntries = (treePositions: Float32Array, removed: ReadonlySet<number>): number[] => {
  const out: number[] = [];
  if (removed.size === 0) return out;
  for (let i = 0; i < treePositions.length; i += 5) {
    if (!removed.has(treeRecordIndex(treePositions[i], treePositions[i + 2]))) continue;
    for (let k = 0; k < 5; k++) out.push(treePositions[i + k]);
  }
  return out;
};

/** Adds stump entries (stride 5) to a chunk's felled-stump list, skipping ones already there. */
export const addFelledStumps = (existing: Float32Array | undefined, entries: number[]): Float32Array | undefined => {
  if (entries.length === 0) return existing;
  const have = new Set<number>();
  if (existing) for (let i = 0; i < existing.length; i += 5) have.add(treeRecordIndex(existing[i], existing[i + 2]));
  const add: number[] = [];
  for (let i = 0; i < entries.length; i += 5) {
    const key = treeRecordIndex(entries[i], entries[i + 2]);
    if (have.has(key)) continue;
    have.add(key);
    for (let k = 0; k < 5; k++) add.push(entries[i + k]);
  }
  if (add.length === 0) return existing;
  const out = new Float32Array((existing?.length ?? 0) + add.length);
  if (existing) out.set(existing);
  out.set(add, existing?.length ?? 0);
  return out;
};
