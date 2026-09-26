import { describe, it, expect } from 'vitest';
import { createWheelStepper } from '@features/interaction/logic/wheelStepper';

describe('wheel stepping', () => {
  it('a mouse notch is one step', () => {
    const s = createWheelStepper();
    expect(s.push(100, 0, 0, 140)).toBe(1);
    expect(s.push(-100, 0, 500, 140)).toBe(-1);
  });

  it('a trackpad flick (many small events) moves one slot, not one per event', () => {
    const s = createWheelStepper();
    let steps = 0;
    for (let i = 0; i < 40; i++) steps += Math.abs(s.push(8, 0, i * 8, 140)); // 320 px over 320 ms
    expect(steps).toBeLessThanOrEqual(3);
    expect(steps).toBeGreaterThanOrEqual(1);
  });

  it('line-mode wheels (Firefox) still step once per notch', () => {
    const s = createWheelStepper();
    expect(s.push(3, 1, 0, 140)).toBe(1);
  });

  it('fast notches are spaced out by the pause', () => {
    const s = createWheelStepper();
    expect(s.push(100, 0, 0, 140)).toBe(1);
    expect(s.push(100, 0, 50, 140)).toBe(0);
    expect(s.push(100, 0, 200, 140)).toBe(1);
  });
});
