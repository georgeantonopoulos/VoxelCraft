import { describe, it, expect } from 'vitest';
import { growTree } from '@features/flora/trees/treeGrowth';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

const HEIGHTS: Record<number, [number, number]> = {
  [TreeType.OAK]: [5, 14],
  [TreeType.PINE]: [9, 18],
  [TreeType.PALM]: [5, 11],
  [TreeType.JUNGLE]: [12, 26],
  [TreeType.ACACIA]: [3.5, 10],
  [TreeType.CACTUS]: [2.5, 6],
};

describe('tree growth', () => {
  for (const [typeStr, [lo, hi]] of Object.entries(HEIGHTS)) {
    const type = Number(typeStr) as TreeType;
    it(`type ${TreeType[type]} builds valid, plausible geometry`, () => {
      for (const lod of ['high', 'low'] as const) {
        const t = growTree(type, 1, lod);
        expect(t.height).toBeGreaterThan(lo);
        expect(t.height).toBeLessThan(hi);
        const { wood, leaves } = t;
        const woodVerts = wood.positions.length / 3;
        expect(woodVerts).toBeGreaterThan(20);
        for (const v of wood.positions) expect(Number.isFinite(v)).toBe(true);
        for (const i of wood.indices) expect(i).toBeLessThan(woodVerts);
        expect(wood.depth.length).toBe(woodVerts);
        expect(wood.axis.length).toBe(woodVerts * 3);
        const leafVerts = leaves.positions.length / 3;
        for (const i of leaves.indices) expect(i).toBeLessThan(leafVerts);
        expect(leaves.uvs.length).toBe(leafVerts * 2);
        if (type !== TreeType.CACTUS) expect(leafVerts).toBeGreaterThan(8);
        // The trunk always gets a collider.
        expect(t.collision.length).toBeGreaterThan(0);
        // Budget per template (triangles).
        expect((wood.indices.length + leaves.indices.length) / 3).toBeLessThan(lod === 'high' ? 9000 : 4000);
      }
    });
  }

  it('is deterministic per variant and differs across variants', () => {
    const a = growTree(TreeType.OAK, 2), b = growTree(TreeType.OAK, 2), c = growTree(TreeType.OAK, 3);
    expect(Array.from(a.wood.positions.slice(0, 30))).toEqual(Array.from(b.wood.positions.slice(0, 30)));
    expect(a.wood.positions.length === c.wood.positions.length && a.height === c.height).toBe(false);
  });
});
