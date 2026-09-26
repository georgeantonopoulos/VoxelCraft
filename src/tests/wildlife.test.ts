import { describe, it, expect } from 'vitest';
import { Group, RootlingState, WildlifeWorld, makeAgent, updateBirds, updateDeer, updateFish, updateRootling, TUNING } from '@features/creatures/wildlife/wildlifeSim';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Flat meadow at y=10 with a lake for x < -20 (bed at 0, surface at 4.5). */
const world: WildlifeWorld = {
  groundAt: (x) => (x < -20 ? 0 : 10),
  waterAt: (x) => (x < -20 ? 4.5 : null),
  habitat: (kind, x) => (kind === 'fish' ? (x < -20 ? 1 : 0) : x < -20 ? 0 : 1),
};

const herd = (n: number, rand: () => number): Group => ({
  kind: 'deer', state: 'graze', timer: 30, tx: 0, ty: 10, tz: 0,
  members: Array.from({ length: n }, (_, i) => makeAgent(i * 1.5, 10, 0, 0, rand)),
});

describe('wildlife behaviour', () => {
  it('deer graze with heads down, then flee from an approaching player', () => {
    const rand = mulberry32(1);
    const g = herd(4, rand);
    for (let i = 0; i < 120; i++) updateDeer(g, 1 / 30, { x: 200, y: 10, z: 200 }, world, rand);
    expect(g.state).toBe('graze');
    expect(g.members.some((a) => a.head > 0.5)).toBe(true);
    const start = g.members.map((a) => Math.hypot(a.x - 5, a.z));
    for (let i = 0; i < 90; i++) updateDeer(g, 1 / 30, { x: 5, y: 10, z: 8 }, world, rand);
    expect(g.state).toBe('flee');
    const end = g.members.map((a) => Math.hypot(a.x - 5, a.z));
    // Every deer ran and ended farther from the player, at running speed.
    g.members.forEach((a, i) => expect(end[i]).toBeGreaterThan(start[i] + 5));
    expect(Math.max(...g.members.map((a) => Math.hypot(a.vx, a.vz)))).toBeGreaterThan(TUNING.deer.walk * 2);
  });

  it('deer never walk into water', () => {
    const rand = mulberry32(2);
    const g = herd(3, rand);
    g.members.forEach((a) => { a.x = -15; });
    for (let i = 0; i < 300; i++) updateDeer(g, 1 / 30, { x: 5, y: 10, z: 0 }, world, rand); // flee toward the lake
    g.members.forEach((a) => expect(a.x).toBeGreaterThan(-21));
  });

  it('feeding birds take off when the player comes close', () => {
    const rand = mulberry32(3);
    const g: Group = { kind: 'bird', state: 'ground', timer: 60, tx: 0, ty: 10, tz: 0,
      members: Array.from({ length: 6 }, () => makeAgent(rand() * 3, 10.06, rand() * 3, 0, rand)) };
    for (let i = 0; i < 30; i++) updateBirds(g, 1 / 30, { x: 50, y: 10, z: 50 }, world, rand);
    expect(g.state).toBe('ground');
    for (let i = 0; i < 90; i++) updateBirds(g, 1 / 30, { x: 2, y: 10, z: 2 }, world, rand);
    expect(['takeoff', 'fly']).toContain(g.state);
    expect(Math.min(...g.members.map((a) => a.y))).toBeGreaterThan(11);
  });

  it('fish stay in the water', () => {
    const rand = mulberry32(4);
    const g: Group = { kind: 'fish', state: 'swim', timer: 0, tx: -40, ty: 3, tz: 0,
      members: Array.from({ length: 6 }, () => makeAgent(-40 + rand() * 4, 3, rand() * 4, 0, rand)) };
    for (let i = 0; i < 600; i++) updateFish(g, 1 / 30, { x: -30, y: 10, z: 0 }, world, rand);
    g.members.forEach((a) => { expect(a.x).toBeLessThan(-20); expect(a.y).toBeLessThan(5.5); });
  });

  it('the rootling waits for the player, leads to the hollow and reports arrival', () => {
    const rand = mulberry32(5);
    const r: RootlingState = { active: true, agent: makeAgent(0, 10, 0, 0, rand), mode: 'wait', targetX: 0, targetZ: 60, timer: 0 };
    for (let i = 0; i < 60; i++) updateRootling(r, 1 / 30, { x: 0, y: 10, z: -40 }, world);
    expect(r.mode).toBe('wait');
    expect(Math.hypot(r.agent.x, r.agent.z)).toBeLessThan(0.5);
    let arrived = false;
    const player = { x: 0, y: 10, z: -6 };
    for (let i = 0; i < 30 * 40 && !arrived; i++) {
      arrived = updateRootling(r, 1 / 30, player, world) || arrived;
      // The player follows a few metres behind.
      player.z += (r.agent.z - 5 - player.z) * 0.05;
    }
    expect(arrived).toBe(true);
    expect(Math.hypot(r.agent.x, r.agent.z - 60)).toBeLessThan(8);
  });

  it('the rootling stays ahead of a player running flat out, and sits on sloped ground', () => {
    const rand = mulberry32(6);
    // A steady 30% slope rising toward the hollow.
    const slope: WildlifeWorld = { ...world, groundAt: (_x, z) => 10 + z * 0.3 };
    const r: RootlingState = { active: true, agent: makeAgent(0, 10, 4, 0, rand), mode: 'lead', targetX: 0, targetZ: 200, timer: 0 };
    const player = { x: 0, y: 10, z: 0, speed: 7 };
    let minGap = Infinity, maxSink = 0;
    for (let i = 0; i < 30 * 20; i++) {
      player.z += 7 / 30; // sprinting straight at the hollow
      updateRootling(r, 1 / 30, player, slope);
      if (i > 60) {
        minGap = Math.min(minGap, r.agent.z - player.z);
        maxSink = Math.max(maxSink, (10 + r.agent.z * 0.3) - r.agent.y);
      }
    }
    expect(minGap).toBeGreaterThan(1.5);
    expect(maxSink).toBeLessThan(0.05);
    expect(r.agent.head).toBeGreaterThan(0.5); // running gait
  });
});
