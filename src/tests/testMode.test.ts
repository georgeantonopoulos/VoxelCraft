import { describe, expect, it } from 'vitest';
import { calculateOrbitAngle } from '@core/graphics/celestial';
import { orbitAngleForHour, orbitOffsetForHour, parseTestParams } from '@/testing/testConfig';
import { WorldType } from '@features/terrain/logic/BiomeManager';

describe('test mode URL parameters', () => {
  it('is off without ?test', () => {
    expect(parseTestParams('?seed=4&autostart')).toBeNull();
  });

  it('defaults to the meadow scenario, fresh, no overrides', () => {
    const p = parseTestParams('?test')!;
    expect(p.scenario).toBe('meadow');
    expect(p.keep).toBe(false);
    expect(p.world).toBeUndefined();
    expect(p.seed).toBeUndefined();
    expect(p.time).toBeUndefined();
    expect(p.give).toEqual([]);
  });

  it('reads every override', () => {
    const p = parseTestParams('?test=carpentry&world=frozen&seed=42&at=100,-20&yaw=90&pitch=-10&time=21.5&weather=rain&hud=hidden&keep&give=saw,stick:3')!;
    expect(p).toMatchObject({
      scenario: 'carpentry', world: WorldType.FROZEN, seed: 42, at: { x: 100, z: -20 },
      yaw: 90, pitch: -10, time: 21.5, weather: 'rain', hud: 'hidden', keep: true, give: ['saw', 'stick:3'],
    });
    expect(parseTestParams('?test&time=live')!.time).toBe('live');
  });

  it('ignores malformed values instead of guessing', () => {
    const p = parseTestParams('?test&world=moon&seed=-3&at=5&weather=snow&hud=loud&time=noon')!;
    expect(p.world).toBeUndefined();
    expect(p.seed).toBeUndefined();
    expect(p.at).toBeUndefined();
    expect(p.weather).toBeUndefined();
    expect(p.hud).toBeUndefined();
    expect(p.time).toBeUndefined();
  });
});

describe('holding the sun at an hour', () => {
  it('maps sunrise, noon, sunset and midnight onto the orbit', () => {
    expect(orbitAngleForHour(6)).toBeCloseTo(-Math.PI / 2);
    expect(orbitAngleForHour(12)).toBeCloseTo(0);
    expect(orbitAngleForHour(18)).toBeCloseTo(Math.PI / 2);
    expect(orbitAngleForHour(0)).toBeCloseTo(Math.PI);
    expect(orbitAngleForHour(24)).toBeCloseTo(Math.PI);
  });

  it('with the orbit stopped, the offset puts the sun at that hour whatever the clock says', () => {
    for (const h of [5, 10.5, 12, 19, 23]) {
      for (const t of [0, 37, 1000]) {
        expect(calculateOrbitAngle(t, 0, orbitOffsetForHour(h))).toBeCloseTo(orbitAngleForHour(h));
      }
    }
  });
});
