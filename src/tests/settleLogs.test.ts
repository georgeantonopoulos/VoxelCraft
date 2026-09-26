import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { settleLogs } from '@features/building/logic/settleLogs';
import type { LogData } from '@/state/LogStore';

const UPRIGHT: [number, number, number, number] = [0, 0, 0, 1];
const lyingAlongX = (() => { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)); return [q.x, q.y, q.z, q.w] as [number, number, number, number]; })();

const post = (id: string, x: number, groundY: number): LogData => ({
  id, position: [x, groundY + 0.8 - 0.12, 0], rotation: UPRIGHT, length: 1.6, radius: 0.15, bark: '#5b4a38', state: 'placed', kind: 'log',
});
// A beam lying across the tops of two posts 2 m apart (posts at x = 0 and 2).
const beam = (id: string, groundY: number): LogData => ({
  id, position: [1, groundY + 1.6 - 0.12 + 0.15, 0], rotation: lyingAlongX, length: 2.4, radius: 0.15, bark: '#5b4a38', state: 'placed', kind: 'log',
});

describe('settling builds on regenerated ground', () => {
  it('lowers a floating build as one piece, keeping its shape', () => {
    const logs = [post('a', 0, 10), post('b', 2, 10), beam('c', 10)];
    const out = settleLogs(logs, () => 7); // ground fell 3 m
    for (const [i, l] of out.entries()) {
      expect(l.position[1]).toBeCloseTo(logs[i].position[1] - 3, 5);
    }
  });

  it('raises a buried build out of the ground', () => {
    const logs = [post('a', 0, 10), post('b', 2, 10), beam('c', 10)];
    const out = settleLogs(logs, () => 12.5);
    expect(out[0].position[1]).toBeCloseTo(logs[0].position[1] + 2.5, 5);
    expect(out[2].position[1] - out[0].position[1]).toBeCloseTo(logs[2].position[1] - logs[0].position[1], 5);
  });

  it('leaves a build alone when the ground under it has not really changed', () => {
    const logs = [post('a', 0, 10), post('b', 2, 10), beam('c', 10)];
    const out = settleLogs(logs, (x) => 10 + x * 0.05); // gentle slope, small differences
    expect(out).toEqual(logs);
  });

  it('moves separate builds independently', () => {
    const logs = [post('a', 0, 10), { ...post('far', 30, 20) }];
    const out = settleLogs(logs, (x) => (x < 15 ? 8 : 21));
    expect(out[0].position[1]).toBeCloseTo(logs[0].position[1] - 2, 5);
    expect(out[1].position[1]).toBeCloseTo(logs[1].position[1] + 1, 5);
  });

  it('lifts a loose log out of ground that rose over it', () => {
    const loose: LogData = { id: 'l', position: [5, 3, 5], rotation: lyingAlongX, length: 1.2, radius: 0.15, bark: '#5b4a38', state: 'loose', kind: 'log' };
    const out = settleLogs([loose], () => 6);
    expect(out[0].position[1]).toBeGreaterThan(6);
  });
});
