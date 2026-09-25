import { describe, it, expect } from 'vitest';
import { calculateOrbitAngle, DAY_FRACTION } from '@core/graphics/celestial';

const SPEED = 0.0087 / 2; // App default (orbitConfig.speed = sunOrbitSpeed / 2)
const PERIOD = (Math.PI * 2) / SPEED;
const sunUp = (t: number) => Math.cos(calculateOrbitAngle(t, SPEED)) > 0;

describe('day/night cycle', () => {
  it('lasts roughly 24 minutes', () => {
    expect(PERIOD / 60).toBeGreaterThan(22);
    expect(PERIOD / 60).toBeLessThan(26);
  });

  it('keeps the sun up for DAY_FRACTION of the cycle', () => {
    let up = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (sunUp((i / n) * PERIOD)) up++;
    expect(up / n).toBeCloseTo(DAY_FRACTION, 2);
  });

  it('opens in daylight, is continuous and monotonic', () => {
    expect(sunUp(0)).toBe(true);
    let prev = calculateOrbitAngle(0, SPEED);
    for (let t = 1; t < PERIOD * 2.5; t += 1) {
      const a = calculateOrbitAngle(t, SPEED);
      expect(a).toBeGreaterThan(prev);
      expect(a - prev).toBeLessThan(0.05);
      prev = a;
    }
  });
});
