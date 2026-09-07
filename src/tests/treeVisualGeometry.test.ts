import { describe, expect, it } from 'vitest';
import { TreeGeometryFactory } from '@/features/flora/logic/TreeGeometryFactory';
import { TreeType } from '@/features/terrain/logic/VegetationConfig';

describe('landscape tree geometry', () => {
  it.each([TreeType.OAK, TreeType.ACACIA, TreeType.PINE, TreeType.JUNGLE])(
    'keeps finite renderable foliage and collision data for tree type %s at both LODs',
    (type) => {
      for (const simplified of [false, true]) {
        const { leaves, wood, collisionData } = TreeGeometryFactory.getTreeGeometry(type, 0, simplified);
        for (const geometry of [leaves, wood]) {
          geometry.computeBoundingSphere();
          expect(Number.isFinite(geometry.boundingSphere?.radius)).toBe(true);
          expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
          expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        }
        expect(leaves.getAttribute('aLeafRand').count).toBe(leaves.getAttribute('position').count);
        expect(collisionData.length).toBeGreaterThan(0);
        for (const collider of collisionData) {
          expect(collider.scale.toArray().every((value: number) => Number.isFinite(value) && value > 0)).toBe(true);
        }
      }
    }
  );

  it('retains reduced geometry at distant LOD and reuses cached templates', () => {
    const near = TreeGeometryFactory.getTreeGeometry(TreeType.OAK, 1, false);
    const far = TreeGeometryFactory.getTreeGeometry(TreeType.OAK, 1, true);
    expect(far.leaves.getAttribute('position').count).toBeLessThan(near.leaves.getAttribute('position').count);
    expect(TreeGeometryFactory.getTreeGeometry(TreeType.OAK, 1, false).leaves).toBe(near.leaves);
  });
});
