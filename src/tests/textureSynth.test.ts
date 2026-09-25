import { describe, it, expect } from 'vitest';
import { synthesizeLayer, packLayer, PBR_LAYER_COUNT, PBR_TILE_METERS } from '@core/graphics/pbr/textureSynth';

const SIZE = 64;

/** Seam jump vs. typical neighbour jump, per direction (max of the two ratios). */
function seamRatio(height: Float32Array, albedo: Float32Array, size: number): number {
  const px = (x: number, y: number) => height[y * size + x] + albedo[(y * size + x) * 3 + 1];
  let innerX = 0, innerY = 0, seamX = 0, seamY = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 1; x++) innerX += Math.abs(px(x + 1, y) - px(x, y));
    seamX += Math.abs(px(0, y) - px(size - 1, y));
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size - 1; y++) innerY += Math.abs(px(x, y + 1) - px(x, y));
    seamY += Math.abs(px(x, 0) - px(x, size - 1));
  }
  const n = size * (size - 1);
  return Math.max((seamX / size) / Math.max(innerX / n, 1e-3), (seamY / size) / Math.max(innerY / n, 1e-3));
}

describe('procedural PBR terrain textures', () => {
  it('has a tile size for every layer', () => {
    expect(PBR_TILE_METERS.length).toBe(PBR_LAYER_COUNT);
  });

  for (let layer = 1; layer < PBR_LAYER_COUNT; layer++) {
    if (layer === 8) continue; // water: flat
    it(`layer ${layer} tiles seamlessly and stays in range`, () => {
      const maps = synthesizeLayer(layer, SIZE);
      for (const arr of [maps.albedo, maps.height, maps.roughness]) {
        for (const v of arr) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
      // A seam would show up as much larger jumps across the wrap edge than inside.
      expect(seamRatio(maps.height, maps.albedo, SIZE)).toBeLessThan(2.5);
    });
  }

  it('is deterministic and packs flat normals for flat height', () => {
    const a = packLayer(synthesizeLayer(2, 32));
    const b = packLayer(synthesizeLayer(2, 32));
    expect(Buffer.from(a.a).equals(Buffer.from(b.a))).toBe(true);
    const flat = packLayer(synthesizeLayer(8, 16));
    expect(flat.b[0]).toBe(128); expect(flat.b[1]).toBe(128);
  });
});
