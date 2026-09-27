import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import type { LogData } from '@/state/LogStore';
import { findBenches, workpieceOn } from '@features/building/logic/benches';
import { cutsFor, missingFor, applyCut, DOOR_HEIGHT } from '@features/building/logic/carpentry';
import { computePlacement, notchInset, type SnapInput, type PlaceMode } from '@features/building/logic/buildSnap';
import { lyingQuat, uprightQuat, frameOf } from '@features/building/logic/pieceFrame';
import { copperFind, veinStrength } from '@features/building/logic/copperVeins';
import { buildNotchedLogGeometry } from '@features/building/logic/pieceGeometry';
import { initializeNoise } from '@core/math/noise';
import { MaterialType } from '@/types';

const q4 = (q: THREE.Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

let n = 0;
const piece = (p: Partial<LogData>): LogData => ({
  id: `t${n++}`, position: [0, 0, 0], rotation: [0, 0, 0, 1], length: 2.4, radius: 0.2, bark: '#5b4a38', state: 'placed', kind: 'log', ...p,
});

const lying = (at: [number, number, number], dir: THREE.Vector3, p: Partial<LogData> = {}) => piece({ position: at, rotation: q4(lyingQuat(dir)), ...p });

const snap = (carried: LogData, mode: PlaceMode, point: THREE.Vector3, target: LogData | undefined, placed: LogData[], view = new THREE.Vector3(0, -0.3, -1).normalize()): ReturnType<typeof computePlacement> => {
  const input: SnapInput = {
    carried, mode, point, normal: new THREE.Vector3(0, 1, 0), target, view, placed,
    benches: findBenches(placed), groundAt: () => 0,
  };
  return computePlacement(input);
};

describe('workbench', () => {
  const legA = piece({ kind: 'plank', length: 0.8, radius: 0.12, position: [-0.45, 0.4, 0], rotation: q4(uprightQuat(Z)) });
  const legB = piece({ kind: 'plank', length: 0.8, radius: 0.12, position: [0.45, 0.4, 0], rotation: q4(uprightQuat(Z)) });
  const top = piece({ kind: 'plank', length: 1.2, radius: 0.12, position: [0, 0.83, 0], rotation: q4(lyingQuat(X)) });

  it('three planks set like a table make a bench', () => {
    const benches = findBenches([legA, legB, top]);
    expect(benches).toHaveLength(1);
    expect(benches[0].id).toBe(top.id);
    expect(benches[0].top[1]).toBeCloseTo(0.86, 2);
  });

  it('legs bunched together, or a top floating above them, are not a bench', () => {
    const close = piece({ ...legB, id: 'close', position: [-0.3, 0.4, 0] });
    expect(findBenches([legA, close, top])).toHaveLength(0);
    const high = piece({ ...top, id: 'high', position: [0, 1.2, 0] });
    expect(findBenches([legA, legB, high])).toHaveLength(0);
  });

  it('a flat plank set on one leg reaches across to the other: a table top', () => {
    const board = piece({ state: 'carried', kind: 'plank', length: 1.3, radius: 0.13 });
    const p = snap(board, 'flat', new THREE.Vector3(-0.43, 0.8, 0.02), legA, [legA, legB]);
    expect(p.position.x).toBeCloseTo(0, 5);
    expect(p.position.y).toBeCloseTo(0.8 + 0.03, 5);
    const made = piece({ ...board, state: 'placed', position: [p.position.x, p.position.y, p.position.z], rotation: q4(p.rotation) });
    expect(findBenches([legA, legB, made])).toHaveLength(1);
  });

  it('a piece aimed at the bench top lies on it, and the bench is then busy', () => {
    const log = piece({ state: 'carried', length: 2.4 });
    const p = snap(log, 'lying', new THREE.Vector3(0.1, 0.86, 0), top, [legA, legB, top]);
    expect(p.onBench).toBe(top.id);
    expect(p.valid).toBe(true);
    expect(p.position.y).toBeCloseTo(0.86 + 0.2 + 0.005, 3);
    const onIt = piece({ ...log, state: 'placed', onBench: top.id, position: [p.position.x, p.position.y, p.position.z] });
    expect(workpieceOn(top.id, [legA, legB, top, onIt])?.id).toBe(onIt.id);
    const again = snap(piece({ state: 'carried' }), 'lying', new THREE.Vector3(0, 0.86, 0), top, [legA, legB, top, onIt]);
    expect(again.valid).toBe(false);
  });
});

describe('carpentry', () => {
  const log = piece({ length: 2.4, radius: 0.2 });
  const noTools = { saw: false, axe: false };
  const tools = { saw: true, axe: true };
  const none = { copper: 0, hinges: 0 };

  it('offers wall logs, posts, planks, roof boards and a door from a log', () => {
    expect(cutsFor(log).map((c) => c.id)).toEqual(['wall', 'post', 'tall', 'short', 'roof', 'door']);
  });

  it('needs an axe to notch and a saw to cut lengths', () => {
    const wall = cutsFor(log).find((c) => c.id === 'wall')!;
    expect(missingFor(wall, log, noTools, none, { pieces: 1 })).toMatch(/axe/);
    expect(missingFor(wall, log, { saw: false, axe: true }, none, { pieces: 1 })).toBeNull();
    expect(missingFor(wall, log, { saw: false, axe: true }, none, { pieces: 2 })).toMatch(/saw/);
  });

  it('cuts notched halves and thirds', () => {
    const wall = cutsFor(log).find((c) => c.id === 'wall')!;
    const halves = applyCut(log, wall, { formation: 'one', pieces: 2 });
    expect(halves.pieces).toHaveLength(2);
    expect(halves.pieces[0].length).toBeCloseTo(1.18, 3);
    expect(halves.pieces.every((p) => p.notches === 'one' && p.kind === 'log')).toBe(true);
    expect(applyCut(log, wall, { formation: 'both', pieces: 3 }).pieces).toHaveLength(3);
  });

  it('hinges cost two copper; a door costs a pair of hinges and a long log', () => {
    const plank = piece({ kind: 'plank', length: 1.2, radius: 0.12 });
    const hinges = cutsFor(plank).find((c) => c.id === 'hinges')!;
    expect(missingFor(hinges, plank, tools, { copper: 1, hinges: 0 })).toMatch(/copper/);
    expect(applyCut(plank, hinges).materials).toEqual({ copper: -2, hinges: 1 });
    const door = cutsFor(log).find((c) => c.id === 'door')!;
    expect(missingFor(door, log, tools, none)).toMatch(/hinges/);
    expect(missingFor(door, log, tools, { copper: 0, hinges: 1 })).toBeNull();
    expect(missingFor(door, piece({ length: 1.5 }), tools, { copper: 0, hinges: 1 })).toMatch(/long/);
    expect(applyCut(log, door).pieces[0]).toMatchObject({ kind: 'door', length: DOOR_HEIGHT });
  });

  it('splits a thick log into more boards', () => {
    const tall = cutsFor(log).find((c) => c.id === 'tall')!;
    expect(applyCut(log, tall).pieces).toHaveLength(3);
    expect(applyCut(piece({ radius: 0.28 }), tall).pieces).toHaveLength(4);
  });
});

describe('log walls', () => {
  it('two notched logs lock half a log into each other at a corner', () => {
    const wallA = lying([0, 0.2, 0], X, { notches: 'both' });
    const carried = piece({ state: 'carried', notches: 'both' });
    // Aim near wallA's +X end, from its -Z side.
    const p = snap(carried, 'lying', new THREE.Vector3(1.05, 0.3, -0.19), wallA, [wallA]);
    const f = frameOf({ position: [0, 0, 0], rotation: q4(p.rotation) });
    expect(Math.abs(f.axis.z)).toBeCloseTo(1, 5); // at right angles
    expect(p.position.y).toBeCloseTo(0.2 + 0.5 * 0.4, 5);
    // It crosses wallA's notch, with its own notch over the crossing.
    expect(p.position.x).toBeCloseTo(1.2 - notchInset(wallA), 5);
    expect(Math.abs(p.position.z)).toBeCloseTo(1.2 - notchInset(carried), 5);
  });

  it('four notched walls close a square: opposite walls level, the others half a log up', () => {
    const r = 0.2;
    const S = lying([0, r, 0], X, { notches: 'both' });
    const log = () => piece({ state: 'carried', notches: 'both' });
    const place = (t: LogData, aim: THREE.Vector3, others: LogData[]): LogData => {
      const p = snap(log(), 'lying', aim, t, others);
      return piece({ notches: 'both', position: [p.position.x, p.position.y, p.position.z], rotation: q4(p.rotation) });
    };
    // Each aim: near the far end of the last wall, on its inner side.
    const E = place(S, new THREE.Vector3(1.0, r * 1.9, 0.1), [S]);
    expect(E.position[1]).toBeCloseTo(2 * r, 5); // over S (S is on the ground)
    const eEnd = new THREE.Vector3(...E.position).add(new THREE.Vector3(-0.1, r * 0.9, 0.9));
    const N = place(E, eEnd, [S, E]);
    expect(N.position[1]).toBeCloseTo(r, 5); // under E: on the ground like S
    const nEnd = new THREE.Vector3(...N.position).add(new THREE.Vector3(-0.9, r * 0.9, -0.1));
    const W = place(N, nEnd, [S, E, N]);
    expect(W.position[1]).toBeCloseTo(2 * r, 5); // over N, level with E
    // W's far end crosses S's notch.
    expect(W.position[0]).toBeCloseTo(S.position[0] - (1.2 - notchInset(S)), 5);
  });

  it('un-notched logs can only sit on top at a corner', () => {
    const wallA = lying([0, 0.2, 0], X);
    const p = snap(piece({ state: 'carried' }), 'lying', new THREE.Vector3(1.05, 0.3, -0.19), wallA, [wallA]);
    expect(p.position.y).toBeCloseTo(0.2 + 0.4, 5);
  });

  it('a long log over a doorway log lines up with its corner end (bridging the doorway)', () => {
    // Notched at +X (the corner, x = 0); its free -X end is the door jamb.
    const short = lying([-0.6, 0.2, 0], X, { length: 1.2, notches: 'one' });
    const p = snap(piece({ state: 'carried', length: 2.4, notches: 'both' }), 'lying', new THREE.Vector3(-1.0, 0.4, 0), short, [short]);
    // Aimed at the jamb end, it still stacks (no corner there), flush with the corner: spans -2.4..0.
    expect(p.position.x + 1.2).toBeCloseTo(0, 5);
    expect(Math.abs(frameOf({ position: [0, 0, 0], rotation: q4(p.rotation) }).axis.x)).toBeCloseTo(1, 5);
    expect(p.position.y).toBeCloseTo(0.2 + 0.2 + 0.19, 5);
  });

  it('turns a log on the ground square to the build nearby', () => {
    const wallA = lying([0, 0.2, 0], X);
    // View heading slightly off-axis: the log still lies square to wallA.
    const view = new THREE.Vector3(0.3, -0.4, -1).normalize();
    const p = snap(piece({ state: 'carried' }), 'lying', new THREE.Vector3(0.2, 0, 1.5), undefined, [wallA], view);
    const f = frameOf({ position: [0, 0, 0], rotation: q4(p.rotation) });
    expect(Math.max(Math.abs(f.axis.x), Math.abs(f.axis.z))).toBeCloseTo(1, 5);
  });
});

describe('levelling', () => {
  it('a bench leg on lower ground stands level with the other leg', () => {
    const legA = piece({ kind: 'plank', length: 0.8, radius: 0.12, position: [0, 0.35, 0], rotation: q4(uprightQuat(X)) });
    const leg = piece({ state: 'carried', kind: 'plank', length: 0.8, radius: 0.12 });
    const p = snap(leg, 'standing', new THREE.Vector3(0.9, -0.25, 0), undefined, [legA]);
    expect(p.position.y + 0.4).toBeCloseTo(0.75, 5);
    // Too far down the slope to reach: it just stands on the ground.
    const far = snap(leg, 'standing', new THREE.Vector3(0.9, -0.8, 0), undefined, [legA]);
    expect(far.position.y).toBeCloseTo(-0.8 + 0.4 - 0.05, 5);
  });
});

describe('roof and door', () => {
  it('a roof board leans from the eave to the ridge between two walls', () => {
    const span = 2.4;
    const south = lying([0, 1.0, 0], X);
    const north = lying([0, 1.0, -span], X);
    const board = piece({ state: 'carried', kind: 'roof', length: 2.4, radius: 0.12 });
    const p = snap(board, 'pitched', new THREE.Vector3(0.3, 1.2, 0), south, [south, north]);
    const f = frameOf({ position: [p.position.x, p.position.y, p.position.z], rotation: q4(p.rotation) });
    // Slopes up toward the other wall.
    expect(f.axis.y).toBeGreaterThan(0.3);
    expect(f.axis.z).toBeLessThan(0);
    const upper = f.center.clone().addScaledVector(f.axis, 1.2);
    expect(upper.z).toBeCloseTo(-span / 2, 1);
    // Face up, not under the eave.
    expect(f.normal.y).toBeGreaterThan(0);
    // Resting on the log, not cutting into it: the underside is one radius from the log's axis.
    const underside = f.center.clone().addScaledVector(f.normal, -0.025);
    const toAxis = new THREE.Vector3(0, 1.0, 0).sub(underside);
    toAxis.x = 0;
    expect(Math.abs(toAxis.dot(f.normal))).toBeCloseTo(0.2, 3);
  });

  it('a door stands in the doorway with its hinge against the wall end', () => {
    const wall = lying([0, 0.2, 0], X, { length: 0.8, notches: 'one' });
    const door = piece({ state: 'carried', kind: 'door', length: DOOR_HEIGHT, radius: 0.46 });
    const p = snap(door, 'upright', new THREE.Vector3(0.9, 0, 0.1), undefined, [wall]);
    const f = frameOf({ position: [p.position.x, p.position.y, p.position.z], rotation: q4(p.rotation) });
    const hinge = f.center.clone().addScaledVector(f.width, -0.46);
    expect(hinge.x).toBeCloseTo(0.4 + 0.03, 5);
    expect(Math.abs(f.axis.y)).toBeCloseTo(1, 5);
    expect(p.position.y).toBeCloseTo(DOOR_HEIGHT / 2 + 0.02, 5);
    expect(p.swing === 1 || p.swing === -1).toBe(true);
  });

  it('standing planks line up edge to edge on a sill log', () => {
    const sill = lying([0, 0.2, 0], X);
    const board = piece({ state: 'carried', kind: 'plank', length: 2.4, radius: 0.12 });
    const first = snap(board, 'standing', new THREE.Vector3(-0.8, 0.4, 0), sill, [sill]);
    expect(first.position.y).toBeCloseTo(0.4 + 1.2, 5);
    const placed = piece({ ...board, state: 'placed', position: [first.position.x, first.position.y, first.position.z], rotation: q4(first.rotation) });
    const next = snap(piece({ ...board, id: 'b2' }), 'standing', new THREE.Vector3(-0.6, 1.2, 0.04), placed, [sill, placed]);
    expect(Math.abs(next.position.x - first.position.x)).toBeCloseTo(0.244, 3);
    expect(next.position.y).toBeCloseTo(first.position.y, 5);
  });
});

describe('copper', () => {
  beforeAll(() => initializeNoise(4242));

  it('is only in rock, and only a few metres down', () => {
    let hits = 0;
    for (let x = 0; x < 60; x += 1.1) for (let y = -12; y < -3; y += 1.3) {
      expect(copperFind(x, y, 5, MaterialType.DIRT, 0, 0)).toBe('none');
      expect(copperFind(x, -1, 5, MaterialType.STONE, 0, 0)).toBe('none');
      if (copperFind(x, y, 5, MaterialType.STONE, 0, 0) === 'nugget') hits++;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('veins stay put in a world', () => {
    const a = veinStrength(12.3, -8.1, 40.2);
    expect(veinStrength(12.3, -8.1, 40.2)).toBe(a);
  });
});

describe('notched log mesh', () => {
  it('has bark and cut-wood groups and no bad vertices', () => {
    const g = buildNotchedLogGeometry(2.4, 0.2, 'both');
    expect(g.groups).toHaveLength(2);
    expect(g.groups[1].count).toBeGreaterThan(0);
    const pos = g.getAttribute('position').array as Float32Array;
    expect(Array.from(pos).every(Number.isFinite)).toBe(true);
    // Scoops reach half a radius into the log at the notch centre.
    let minTop = Infinity;
    for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 1] - (1.2 - 0.25)) < 0.02 && Math.abs(pos[i]) < 0.02 && pos[i + 2] > 0) minTop = Math.min(minTop, pos[i + 2]);
    expect(minTop).toBeCloseTo(0.1, 2);
  });
});
