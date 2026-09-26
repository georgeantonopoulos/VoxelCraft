import { describe, it, expect } from 'vitest';
import { treeRecordIndex, filterRemovedTrees } from '@state/pickupKeys';

describe('Felled-tree persistence keys', () => {
  it('is stable for a position and distinct for nearby trees', () => {
    expect(treeRecordIndex(3.25, 17.5)).toBe(treeRecordIndex(3.25, 17.5));
    expect(treeRecordIndex(3.25, 17.5)).not.toBe(treeRecordIndex(3.25, 17.75));
    expect(treeRecordIndex(-2, 33.9)).not.toBe(treeRecordIndex(33.9, -2));
  });

  it('removes exactly the felled trees, independent of array order', () => {
    const trees = new Float32Array([
      1, 10, 1, 0, 1.0,
      5, 11, 6, 1, 0.9,
      20, 12, 30, 2, 1.1,
    ]);
    const removed = new Set([treeRecordIndex(5, 6)]);
    const out = filterRemovedTrees(trees, removed);
    expect(Array.from(out)).toEqual([1, 10, 1, 0, 1.0, 20, 12, 30, 2, Math.fround(1.1)]);
    expect(filterRemovedTrees(trees, new Set())).toBe(trees);
  });
});

describe('felled stumps', () => {
  it('records the stump of each removed tree once', async () => {
    const { removedTreeEntries, addFelledStumps, treeRecordIndex } = await import('@state/pickupKeys');
    const trees = new Float32Array([1, 10, 2, 0, 1.1, 5, 11, 6, 1, 0.9, 9, 12, 9, 0, 1.0]);
    const removed = new Set([treeRecordIndex(5, 6)]);
    const entries = removedTreeEntries(trees, removed);
    expect(entries).toEqual([5, 11, 6, 1, expect.closeTo(0.9, 5)]);
    const once = addFelledStumps(undefined, entries)!;
    const twice = addFelledStumps(once, entries);
    expect(once.length).toBe(5);
    expect(twice).toBe(once);
  });
});
