import * as THREE from 'three';
import { useLogStore, type LogData } from '@/state/LogStore';
import { useBuildModeStore } from '@features/building/buildModeStore';
import type { PlaceMode } from '@features/building/logic/buildSnap';
import { frameOf } from '@features/building/logic/pieceFrame';
import type { VcTestApi } from './TestHarness';

/**
 * Builds a notched log cabin the way a player does: carry a piece, aim, place
 * (BuildPreview's snapping, support check and all). Walls of 3 m logs, seven
 * courses, a doorway of half logs on the south side with a lintel over it, a
 * board roof on the south and north walls, and a door. The player flies
 * (double-tapped Space) to reach the upper courses. Ids end up on
 * `window.__hut` ({ W, S, N, E, roof, door, center }) for later steps.
 */

export interface HutIds { W: string[]; S: string[]; N: string[]; E: string[]; roof: string[]; door: string; center: { x: number; z: number } }

const LEN = 3.0;
const R = 0.2;
const BARK = '#5b4a38';

let seq = 0;

/** Carry a new piece, set how it is laid, aim, and place it. Returns its id. */
export async function placeVia(t: VcTestApi, piece: Partial<LogData>, mode: PlaceMode, aim: THREE.Vector3): Promise<string> {
  const store = useLogStore.getState();
  if (store.carried.length) store.removeLogs([...store.carried]);
  const id = piece.id ?? `hut-${seq++}`;
  store.addLogs([{ id, kind: 'log', length: LEN, radius: R, bark: BARK, state: 'loose', position: [0, -500, 0], rotation: [0, 0, 0, 1], ...piece } as LogData]);
  useLogStore.getState().pickUp(id);
  useBuildModeStore.setState({ modes: { ...useBuildModeStore.getState().modes, [piece.kind ?? 'log']: mode } });
  t.lookAt(aim.x, aim.y, aim.z);
  await t.frames(4);
  window.dispatchEvent(new CustomEvent('vc-log-place-request'));
  await t.frames(3);
  return id;
}

const logOf = (id: string) => useLogStore.getState().logs[id];

/** Aim point on the top of a placed log, `along` metres from its centre, nudged toward the hut's middle. */
const onTop = (id: string, along: number, c: { x: number; z: number }): THREE.Vector3 => {
  const f = frameOf(logOf(id));
  const a = f.axis.clone().setY(0).normalize();
  const inward = new THREE.Vector3(c.x - f.center.x, 0, c.z - f.center.z);
  inward.addScaledVector(a, -inward.dot(a));
  if (inward.lengthSq() > 1e-6) inward.normalize();
  return f.center.clone().addScaledVector(a, along).addScaledVector(inward, 0.05).setY(f.center.y + R * 0.95);
};

/** Which end of a placed log (+1 / -1 along its axis) points toward (x, z). */
const endToward = (id: string, x: number, z: number): number => {
  const f = frameOf(logOf(id));
  return (x - f.center.x) * f.axis.x + (z - f.center.z) * f.axis.z >= 0 ? 1 : -1;
};

export async function buildLogHut(t: VcTestApi, center: { x: number; z: number }): Promise<HutIds> {
  seq = 0;
  // Fly, so the upper courses and the roof can be reached from above.
  await t.key('Space', 60); await t.wait(90); await t.key('Space', 60);
  const hover = async (y: number) => { t.teleport(center.x, y, center.z); await t.frames(3); };
  const g0 = t.groundAt(center.x, center.z);
  await hover(g0 + 1.2);

  const W: string[] = [], S: string[] = [], N: string[] = [], E: string[] = [];
  const log = (length: number, notches: 'both' | 'one'): Partial<LogData> => ({ kind: 'log', length, radius: R, notches });
  const wx = center.x - 1.25;
  W.push(await placeVia(t, log(LEN, 'both'), 'lying', new THREE.Vector3(wx, t.groundAt(wx, center.z), center.z)));
  const corner = LEN * 0.36;
  const course = async (k: number, doorway: boolean) => {
    await hover(logOf(W[k]).position[1] + 0.6);
    const south = endToward(W[k], center.x, center.z + 5);
    S.push(await placeVia(t, doorway ? log(LEN / 2 - 0.02, 'one') : log(LEN, 'both'), 'lying', onTop(W[k], south * corner, center)));
    N.push(await placeVia(t, log(LEN, 'both'), 'lying', onTop(W[k], -south * corner, center)));
    const east = endToward(N[k], center.x + 5, center.z);
    E.push(await placeVia(t, log(LEN, 'both'), 'lying', onTop(N[k], east * corner, center)));
  };
  await course(0, true);
  for (let k = 1; k < 7; k++) {
    await hover(logOf(W[k - 1]).position[1] + 0.6);
    W.push(await placeVia(t, log(LEN, 'both'), 'lying', onTop(W[k - 1], 0.1, center)));
    await course(k, k < 5);
  }

  // Roof boards on the south and north wall tops.
  const roof: string[] = [];
  const top = Math.max(...[...W, ...S, ...N, ...E].map((id) => logOf(id).position[1]));
  await hover(top + 1.0);
  for (const wall of [S[6], N[6]]) {
    for (let k = -5; k <= 5; k++) {
      const id = await placeVia(t, { kind: 'roof', length: 2.4, radius: 0.12 }, 'pitched', onTop(wall, k * 0.244, center));
      if (logOf(id)?.state === 'placed') roof.push(id);
    }
  }

  // The door, in the gap beside the doorway logs' free end.
  await hover(g0 + 0.9);
  const f0 = frameOf(logOf(S[0]));
  const free = f0.center.clone().addScaledVector(f0.axis, -logOf(S[0]).length / 2);
  const gap = free.clone().addScaledVector(f0.axis.clone().setY(0).normalize(), -0.5);
  gap.z -= 0.1;
  const door = await placeVia(t, { kind: 'door', length: 1.85, radius: 0.46 }, 'upright', new THREE.Vector3(gap.x, t.groundAt(gap.x, gap.z), gap.z));

  const ids: HutIds = { W, S, N, E, roof, door, center };
  (window as unknown as { __hut?: HutIds }).__hut = ids;
  return ids;
}
