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
