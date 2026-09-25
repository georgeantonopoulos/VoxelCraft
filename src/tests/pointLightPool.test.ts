import { describe, it, expect } from 'vitest';
import { POOLED_LIGHT_COUNT } from '@core/graphics/PointLightPool';

describe('PointLightPool', () => {
  it('keeps a fixed, small number of real lights', () => {
    // Lit shaders are compiled per light count; this must stay a constant.
    expect(POOLED_LIGHT_COUNT).toBeGreaterThanOrEqual(8);
    expect(POOLED_LIGHT_COUNT).toBeLessThanOrEqual(16);
  });
});
