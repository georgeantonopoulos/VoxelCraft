import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VEGETATION_GEOMETRIES } from '@/features/terrain/logic/VegetationGeometries';

describe('grass surface topology', () => {
  it.each(['grass_low', 'grass_tall', 'grass_carpet', 'fern', 'broadleaf'] as const)(
    '%s has no duplicate backfaces or zero-area tip triangles',
    (name) => {
      const geometry = VEGETATION_GEOMETRIES[name];
      const positions = geometry.getAttribute('position');
      const indices = geometry.getIndex()!;
      const triangles = new Set<string>();
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      for (let i = 0; i < indices.count; i += 3) {
        const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
        const key = [...ids].sort((x, y) => x - y).join(',');
        expect(triangles.has(key)).toBe(false);
        triangles.add(key);
        a.fromBufferAttribute(positions, ids[0]);
        b.fromBufferAttribute(positions, ids[1]).sub(a);
        c.fromBufferAttribute(positions, ids[2]).sub(a);
        expect(b.cross(c).lengthSq()).toBeGreaterThan(1e-12);
      }
    }
  );
});
