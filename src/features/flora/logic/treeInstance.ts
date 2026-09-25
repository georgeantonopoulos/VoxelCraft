/**
 * Per-instance tree appearance, shared by the terrain worker (static instanced
 * trees) and FallingTree (the felled copy), so a chopped tree keeps its exact
 * variant, rotation and size while it falls.
 *
 * Inputs are the chunk-local x/z stored in treePositions.
 */
const JUNGLE_TREE_TYPE = 5;
const JUNGLE_VARIANTS = 4;

export const treeSeed = (localX: number, localZ: number): number => localX * 12.9898 + localZ * 78.233;

export const treeVariant = (type: number, localX: number, localZ: number): number => {
  if (type !== JUNGLE_TREE_TYPE) return 0;
  const h = Math.abs(Math.sin(treeSeed(localX, localZ))) * 43758.5453;
  return Math.floor((h % 1) * JUNGLE_VARIANTS);
};

export const treeRotationY = (localX: number, localZ: number): number => (treeSeed(localX, localZ) % 1) * Math.PI * 2;
