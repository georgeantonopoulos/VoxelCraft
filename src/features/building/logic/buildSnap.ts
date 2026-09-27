import * as THREE from 'three';
import { pieceHalfDepth, isBoard, type LogData, type PieceKind } from '@/state/LogStore';
import type { Bench } from './benches';
import {
  UP, frameOf, isUpright, isFlatFace, lyingQuat, uprightQuat, basisQuat, yawOf, dirOfYaw, buildYawOf, snapYaw,
  type PieceFrame,
} from './pieceFrame';

/**
 * Where a carried piece goes (pure; BuildPreview draws the ghost and places
 * it). The rules that make pieces join into a hut:
 * - near a build, everything turns square to it (quarter turns of the first
 *   piece), so walls, floors and roofs line up;
 * - a lying log aimed near the (notched) end of a lying log turns the corner. Two
 *   notched logs lock half a log into each other; an un-notched log can only
 *   sit on top, a full log higher;
 * - aimed along a log, it becomes the next course: same line, ends flush
 *   with the end nearest the aim (a long log over a short one bridges a
 *   doorway);
 * - a log laid on a post spans to the nearest post at the same height;
 * - boards lie flat, stand (tall planks: on the ground or on a log, side by
 *   side), or pitch; aimed at a board of the same set they continue beside it;
 * - posts and standing boards on sloping ground level their tops with a
 *   neighbour (bench legs, frames);
 * - a roof board aimed at a wall top leans from an eave overhang up to the
 *   ridge between that wall and the one opposite;
 * - a door stands in a doorway with its hinge against the nearest wall end;
 * - any piece aimed at a free workbench top lies on it, ready to shape.
 */

export type PlaceMode = 'lying' | 'upright' | 'flat' | 'standing' | 'pitched';

export const modesFor = (kind: PieceKind | undefined): PlaceMode[] => {
  switch (kind) {
    case 'plank': return ['flat', 'standing', 'pitched'];
    case 'roof': return ['pitched', 'flat'];
    case 'post': return ['upright', 'lying'];
    case 'door': return ['upright'];
    default: return ['lying', 'upright'];
  }
};

export const MODE_LABEL: Record<PlaceMode, string> = {
  lying: 'lying', upright: 'upright', flat: 'flat', standing: 'standing', pitched: 'pitched',
};

export interface SnapInput {
  carried: LogData;
  mode: PlaceMode;
  /** Where the view ray met terrain or a placed piece. */
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** The placed piece hit, if any. */
  target?: LogData;
  /** Unit view direction. */
  view: THREE.Vector3;
  /** Every placed piece. */
  placed: LogData[];
  benches: Bench[];
  groundAt: (x: number, z: number) => number;
}

export interface Placement {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  valid: boolean;
  /** Set when the piece goes onto a workbench. */
  onBench?: string;
  /** Doors: which way it swings. */
  swing?: 1 | -1;
  /** Other placed pieces moved to fit (a bench leg driven down to level). */
  adjust?: { id: string; position: [number, number, number]; rotation?: [number, number, number, number] }[];
}

/** How far a post or standing board is sunk into the ground. */
export const SINK = 0.12;
const BOARD_SINK = 0.05;
/** Gap between boards laid side by side. */
const BOARD_GAP = 0.004;
/** Roof eave overhang past the wall's outer face. */
const EAVE = 0.3;
const MIN_PITCH = 0.35;
const MAX_PITCH = 1.05;
/** Distance from a log's end to the centre of its notch. */
export const notchInset = (l: Pick<LogData, 'radius'>): number => l.radius + 0.05;

const horizontal = (v: THREE.Vector3): THREE.Vector3 => {
  const h = v.clone().setY(0);
  return h.lengthSq() < 1e-8 ? new THREE.Vector3(1, 0, 0) : h.normalize();
};

/** Top surface height of a placed piece (where something set on it rests). */
const topOf = (t: LogData, f: PieceFrame): number => {
  if (isUpright(f)) return f.center.y + t.length / 2;
  if (isBoard(t.kind)) return f.center.y + Math.abs(f.normal.y) * pieceHalfDepth(t) + Math.abs(f.axis.y) * t.length / 2;
  return f.center.y + t.radius;
};

/** Horizontal distance from a point to a piece's long-axis segment. */
const distToPiece = (p: THREE.Vector3, l: LogData): number => {
  const f = frameOf(l);
  const d = p.clone().sub(f.center);
  const along = THREE.MathUtils.clamp(d.dot(f.axis), -l.length / 2, l.length / 2);
  const q = f.center.clone().addScaledVector(f.axis, along).sub(p);
  q.y = 0;
  return q.length();
};

/** Heading of the build nearest `p` (null if nothing is built within 4 m). */
export const frameYawNear = (p: THREE.Vector3, placed: LogData[], excludeId?: string): number | null => {
  let best: LogData | null = null;
  let bestD = 4;
  for (const l of placed) {
    if (l.id === excludeId || l.onBench) continue;
    const d = distToPiece(p, l);
    if (d < bestD) { bestD = d; best = l; }
  }
  return best ? buildYawOf(frameOf(best)) : null;
};

/** Horizontal direction across the view, squared to the build if there is one. */
const acrossDir = (i: SnapInput, at: THREE.Vector3): THREE.Vector3 => {
  const flat = horizontal(i.view);
  let yaw = yawOf(new THREE.Vector3(-flat.z, 0, flat.x));
  const frame = frameYawNear(at, i.placed, i.carried.id);
  if (frame !== null) yaw = snapYaw(yaw, frame);
  return dirOfYaw(yaw);
};

/** Is the lying log `l` notched at the end its local +Y (s = 1) or -Y (s = -1) points to? */
const notchedAt = (l: LogData, s: number): boolean =>
  (l.kind ?? 'log') === 'log' && (l.notches === 'both' || (l.notches === 'one' && s > 0));

/** Centre of the build around a piece: mean of placed walls/posts within 5 m. */
const buildCentroid = (t: LogData, placed: LogData[]): THREE.Vector3 => {
  const c = new THREE.Vector3();
  let n = 0;
  const tc = new THREE.Vector3(...t.position);
  for (const l of placed) {
    if (l.kind === 'roof' || l.kind === 'door' || l.onBench) continue;
    const p = new THREE.Vector3(...l.position);
    if (Math.hypot(p.x - tc.x, p.z - tc.z) > 5) continue;
    c.add(p); n++;
  }
  return n ? c.multiplyScalar(1 / n) : tc;
};

const placeOnBench = (i: SnapInput, bench: Bench): Placement => {
  const top = i.placed.find((l) => l.id === bench.id)!;
  const busy = i.placed.some((l) => l.onBench === bench.id);
  const f = frameOf(top);
  const along = horizontal(f.axis);
  // Round and square pieces lie along the bench; boards lie face up.
  const rot = lyingQuat(along);
  const lift = isBoard(i.carried.kind) ? pieceHalfDepth(i.carried) : i.carried.radius;
  const pos = new THREE.Vector3(bench.top[0], bench.top[1] + lift + 0.005, bench.top[2]);
  return { position: pos, rotation: rot, valid: !busy, onBench: bench.id };
};

const placeDoor = (i: SnapInput): Placement => {
  const c = i.carried;
  // The nearest end of a lying wall piece within reach is the doorway's jamb.
  let best: { end: THREE.Vector3; a: THREE.Vector3; into: number } | null = null;
  let bestD = 1.1;
  for (const l of i.placed) {
    if (l.onBench || isBoard(l.kind)) continue;
    const f = frameOf(l);
    if (isUpright(f)) continue;
    const a = horizontal(f.axis);
    for (const s of [-1, 1]) {
      const end = f.center.clone().addScaledVector(a, s * l.length / 2);
      const d = Math.hypot(end.x - i.point.x, end.z - i.point.z);
      if (d < bestD) { bestD = d; best = { end, a, into: s }; }
    }
  }
  let width: THREE.Vector3;
  let center: THREE.Vector3;
  if (best) {
    // Door leaf runs from the jamb into the gap, in the wall's line.
    width = best.a.clone().multiplyScalar(best.into);
    center = best.end.clone().addScaledVector(width, c.radius + 0.03);
  } else {
    width = acrossDir(i, i.point);
    center = i.point.clone();
  }
  const ground = best ? i.groundAt(center.x, center.z) : i.point.y;
  center.y = ground + c.length / 2 + 0.02;
  const valid = best ? true : i.normal.y > 0.6;
  // Opens away from the player.
  const n = new THREE.Vector3().crossVectors(width, UP);
  const swing: 1 | -1 = n.dot(horizontal(i.view)) >= 0 ? 1 : -1;
  return { position: center, rotation: uprightQuat(width), valid, swing };
};

/** A roof board leaning from a wall top (the target) up to the ridge. */
const placeEave = (i: SnapInput, wall: LogData): Placement => {
  const c = i.carried;
  const f = frameOf(wall);
  const a = horizontal(f.axis);
  const centroid = buildCentroid(wall, i.placed);
  let n = new THREE.Vector3().crossVectors(UP, a).normalize();
  const toC = centroid.clone().sub(f.center).setY(0);
  const lean = toC.dot(n);
  if (Math.abs(lean) < 0.1) { if (n.dot(horizontal(i.view)) < 0) n.negate(); }
  else if (lean < 0) n.negate();
  // Opposite wall: the nearest parallel lying piece on the inside, at a similar height.
  let span: number | null = null;
  for (const l of i.placed) {
    if (l.id === wall.id || l.onBench || isBoard(l.kind)) continue;
    const lf = frameOf(l);
    if (isUpright(lf) || Math.abs(horizontal(lf.axis).dot(a)) < 0.95) continue;
    if (Math.abs(lf.center.y - f.center.y) > 0.9) continue;
    const d = lf.center.clone().sub(f.center).dot(n);
    if (d > 0.8 && (span === null || d < span)) span = d;
  }
  const rT = wall.radius;
  let pitch = 0.62;
  if (span !== null) {
    const run = span / 2 + EAVE + rT;
    pitch = Math.acos(THREE.MathUtils.clamp(run / c.length, Math.cos(MAX_PITCH), Math.cos(MIN_PITCH)));
  }
  const up = n.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
  let width = a.clone();
  if (new THREE.Vector3().crossVectors(width, up).y < 0) width = width.negate();
  const normal = new THREE.Vector3().crossVectors(width, up).normalize();
  // Along the wall: boards tile from the wall's end.
  const step = 2 * c.radius + BOARD_GAP;
  const along = i.point.clone().sub(f.center).dot(a);
  const start = -wall.length / 2 - EAVE * 0.5;
  const k = Math.max(0, Math.round((along - start - c.radius) / step));
  const at = start + c.radius + k * step;
  // The board rests tangent on the log (touching where the log's surface
  // faces the same way as the board), not through its top line.
  const axisPoint = f.center.clone().addScaledVector(a, at);
  const contact = axisPoint.clone().addScaledVector(normal, rT);
  // Lower end: EAVE past the wall's outer face, measured across the wall.
  const sLow = (-(rT + EAVE) - normal.dot(n) * rT) / up.dot(n);
  const pos = contact.addScaledVector(up, sLow + c.length / 2).addScaledVector(normal, pieceHalfDepth(c));
  return { position: pos, rotation: basisQuat(width, up), valid: true };
};

/**
 * A post or standing board set on the ground near others of its kind levels
 * its top with theirs, so bench legs, foundation posts and board walls line
 * up on uneven ground. On higher ground the new one is sunk deeper; on lower
 * ground the others (the level group it joins) are driven down to match,
 * each keeping at least MIN_EXPOSED above its ground. Small rises stand a
 * touch proud.
 */
const LEVEL_REACH_BOARD = 1.8;
/** Reaches the far corner of a 2.5 m square base. */
const LEVEL_REACH_POST = 3.7;
const MIN_EXPOSED = 0.3;
const MAX_PROUD = 0.1;
/** Centre spacing a second bench leg snaps to beside a lone first one. */
export const LEG_SPACING = 0.9;
/**
 * Post-to-post spacings for a square base: a standard wall log's length less
 * its two notch overhangs (3 m logs: 2.5 m; 2.4 m logs: 1.9 m), so sill logs
 * laid across the posts meet at notched corners.
 */
export const POST_SPACINGS = [2.5, 1.9];

interface Leveled { position: THREE.Vector3; adjust?: { id: string; position: [number, number, number] }[] }

const topOfUpright = (l: LogData): number => l.position[1] + l.length / 2;

/** Is anything resting on top of this upright? */
const carriesSomething = (i: SnapInput, u: LogData): boolean => i.placed.some((o) => o.id !== u.id && !o.onBench
  && Math.abs(o.position[1] - topOfUpright(u)) < 0.6
  && Math.hypot(o.position[0] - u.position[0], o.position[2] - u.position[2]) < 0.5 + o.length / 2);

const levelWithNeighbour = (i: SnapInput, pos: THREE.Vector3): Leveled => {
  const c = i.carried;
  const board = isBoard(c.kind);
  const reachXZ = board ? LEVEL_REACH_BOARD : LEVEL_REACH_POST;
  const ups = i.placed.filter((l) => !l.onBench && l.kind !== 'door' && isBoard(l.kind) === board && isUpright(frameOf(l))
    && Math.hypot(l.position[0] - pos.x, l.position[2] - pos.z) <= reachXZ);
  if (!ups.length) return { position: pos };
  ups.sort((p, q) => Math.hypot(p.position[0] - pos.x, p.position[2] - pos.z) - Math.hypot(q.position[0] - pos.x, q.position[2] - pos.z));
  const ref = topOfUpright(ups[0]);
  const group = ups.filter((u) => Math.abs(topOfUpright(u) - ref) < 0.12);
  const groupTop = Math.max(...group.map(topOfUpright));
  const myGround = pos.y - c.length / 2 + (board ? BOARD_SINK : SINK);
  const myTop = pos.y + c.length / 2;
  const shift = groupTop - myTop;
  if (shift <= MAX_PROUD) {
    // Sink this one (or let it stand a touch proud) to the group's height.
    if (groupTop - myGround < MIN_EXPOSED) return { position: pos };
    return { position: pos.clone().setY(pos.y + shift) };
  }
  // Lower ground here: drive the group down to this one's height, if they can all go.
  for (const u of group) {
    if (carriesSomething(i, u)) return { position: pos };
    if (myTop - i.groundAt(u.position[0], u.position[2]) < MIN_EXPOSED) return { position: pos };
  }
  return { position: pos, adjust: group.map((u) => ({ id: u.id, position: [u.position[0], u.position[1] - shift, u.position[2]] as [number, number, number] })) };
};

/**
 * A second standing board aimed near a lone first one snaps to a bench leg's
 * spacing from it, in line with its face or its edge (whichever the aim is
 * nearer), turned the same way. Boards in a wall run are left alone.
 */
const partnerLegSpot = (i: SnapInput): { position: THREE.Vector3; rotation: THREE.Quaternion; partner: LogData; dir: THREE.Vector3 } | null => {
  const c = i.carried;
  const uprights = i.placed.filter((l) => !l.onBench && l.kind !== 'door' && isBoard(l.kind) && isUpright(frameOf(l)));
  let best: { l: LogData; d: number } | null = null;
  for (const l of uprights) {
    const d = Math.hypot(l.position[0] - i.point.x, l.position[2] - i.point.z);
    if (d < 0.3 || d > 1.8 || (best && d > best.d)) continue;
    const lone = !uprights.some((o) => o.id !== l.id && Math.hypot(o.position[0] - l.position[0], o.position[2] - l.position[2]) < 0.6);
    if (lone) best = { l, d };
  }
  if (!best) return null;
  const f = frameOf(best.l);
  const off = i.point.clone().sub(f.center).setY(0);
  const n = horizontal(f.normal), w = horizontal(f.width);
  const alongN = off.dot(n), alongW = off.dot(w);
  const dir = Math.abs(alongN) >= Math.abs(alongW) ? n.multiplyScalar(Math.sign(alongN) || 1) : w.multiplyScalar(Math.sign(alongW) || 1);
  const p = f.center.clone().addScaledVector(dir, LEG_SPACING);
  p.y = i.groundAt(p.x, p.z) + c.length / 2 - BOARD_SINK;
  return { position: p, rotation: f.q.clone(), partner: best.l, dir };
};

/** Height of a workbench top above the ground (legs longer than this are driven in). */
export const BENCH_HEIGHT = 0.8;

/**
 * The second bench leg joins the first: both stand face-on across the line
 * between them (end panels, so the top rests on their full width), and both
 * are driven into the ground to leave a working height, level with each other.
 */
const pairLegs = (i: SnapInput, leg: { position: THREE.Vector3; partner: LogData; dir: THREE.Vector3 }): Placement | null => {
  const c = i.carried;
  const A = leg.partner;
  const faceAcross = uprightQuat(new THREE.Vector3().crossVectors(UP, leg.dir).normalize());
  const gA = i.groundAt(A.position[0], A.position[2]);
  const gB = i.groundAt(leg.position.x, leg.position.z);
  const aTop = A.position[1] + A.length / 2;
  const bMaxTop = gB + c.length - BOARD_SINK;
  let top = Math.min(Math.max(gA, gB) + BENCH_HEIGHT, aTop, bMaxTop);
  // Too steep to pair (a leg would have to be lifted off its ground): stand it on its own.
  if (top < Math.max(gA, gB) + MIN_EXPOSED) return null;
  const pos = leg.position.clone().setY(top - c.length / 2);
  const rot: [number, number, number, number] = [faceAcross.x, faceAcross.y, faceAcross.z, faceAcross.w];
  return {
    position: pos, rotation: faceAcross, valid: i.normal.y > 0.6,
    adjust: [{ id: A.id, position: [A.position[0], top - A.length / 2, A.position[2]], rotation: rot }],
  };
};

/**
 * A post aimed near where a square base's next corner would be (one wall
 * span from an existing post, square to it) snaps there, turned the same way.
 */
const cornerPostSpot = (i: SnapInput): { position: THREE.Vector3; rotation: THREE.Quaternion } | null => {
  const c = i.carried;
  const posts = i.placed.filter((l) => !l.onBench && !isBoard(l.kind) && isUpright(frameOf(l)));
  let best: { p: THREE.Vector3; q: THREE.Quaternion; d: number } | null = null;
  for (const post of posts) {
    const f = frameOf(post);
    for (const axis of [horizontal(f.width), horizontal(f.normal)]) {
      for (const span of POST_SPACINGS) {
        for (const sgn of [1, -1]) {
          const spot = f.center.clone().addScaledVector(axis, sgn * span);
          const d = Math.hypot(spot.x - i.point.x, spot.z - i.point.z);
          if (d > 0.9 || (best && d >= best.d)) continue;
          if (posts.some((o) => Math.hypot(o.position[0] - spot.x, o.position[2] - spot.z) < 0.4)) continue;
          best = { p: spot, q: f.q.clone(), d };
        }
      }
    }
  }
  if (!best) return null;
  best.p.y = i.groundAt(best.p.x, best.p.z) + c.length / 2 - SINK;
  return { position: best.p, rotation: best.q };
};

/**
 * A pair of level uprights (bench legs, posts) near `p`: the one whose
 * midpoint is nearest, close enough for a piece of length `len` to span.
 */
const uprightPairNear = (i: SnapInput, p: THREE.Vector3, len: number): { mid: THREE.Vector3; dir: THREE.Vector3 } | null => {
  const ups = i.placed.filter((l) => !l.onBench && l.kind !== 'door' && isUpright(frameOf(l)));
  let best: { mid: THREE.Vector3; dir: THREE.Vector3; d: number } | null = null;
  for (let a = 0; a < ups.length; a++) {
    for (let b = a + 1; b < ups.length; b++) {
      const A = ups[a], B = ups[b];
      const ta = A.position[1] + A.length / 2, tb = B.position[1] + B.length / 2;
      if (Math.abs(ta - tb) > 0.12) continue;
      const d = new THREE.Vector3(B.position[0] - A.position[0], 0, B.position[2] - A.position[2]);
      const dist = d.length();
      if (dist < 0.4 || dist > len + 0.1) continue;
      const mid = new THREE.Vector3((A.position[0] + B.position[0]) / 2, Math.max(ta, tb), (A.position[2] + B.position[2]) / 2);
      const m = Math.hypot(mid.x - p.x, mid.z - p.z);
      if (m > 1.3 || (best && m > best.d)) continue;
      best = { mid, dir: d.normalize(), d: m };
    }
  }
  return best ? { mid: best.mid, dir: best.dir } : null;
};

/**
 * Two bench legs near `p`: a lone pair of standing boards (nothing else
 * standing within 0.6 m of either, so not part of a board wall) with level
 * tops, close enough for a board of length `len` to span them.
 */
export const benchLegPairNear = (placed: LogData[], p: THREE.Vector3, len: number): { mid: THREE.Vector3; dir: THREE.Vector3 } | null => {
  const legs = placed.filter((l) => !l.onBench && l.kind === 'plank' && isUpright(frameOf(l)));
  const near = (a: LogData, b: LogData) => Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
  let best: { mid: THREE.Vector3; dir: THREE.Vector3; d: number } | null = null;
  for (let a = 0; a < legs.length; a++) {
    for (let b = a + 1; b < legs.length; b++) {
      const A = legs[a], B = legs[b];
      const dist = near(A, B);
      if (dist < 0.4 || dist > len + 0.1) continue;
      const ta = A.position[1] + A.length / 2, tb = B.position[1] + B.length / 2;
      if (Math.abs(ta - tb) > 0.12) continue;
      if (legs.some((o) => o !== A && o !== B && (near(o, A) < 0.6 || near(o, B) < 0.6))) continue;
      const mid = new THREE.Vector3((A.position[0] + B.position[0]) / 2, Math.max(ta, tb), (A.position[2] + B.position[2]) / 2);
      const d = Math.min(Math.hypot(mid.x - p.x, mid.z - p.z), Math.hypot(A.position[0] - p.x, A.position[2] - p.z), Math.hypot(B.position[0] - p.x, B.position[2] - p.z));
      if (d > 1.3 || (best && d > best.d)) continue;
      best = { mid, dir: new THREE.Vector3(B.position[0] - A.position[0], 0, B.position[2] - A.position[2]).normalize(), d };
    }
  }
  return best ? { mid: best.mid, dir: best.dir } : null;
};

/**
 * Two parallel lying logs (or beams) near `p` with level tops, far enough
 * apart for a board of length `len` to lie across both (sawhorses, joists).
 * Returns where the board's middle goes and its direction (across the logs).
 */
export const logPairNear = (placed: LogData[], p: THREE.Vector3, len: number): { mid: THREE.Vector3; dir: THREE.Vector3 } | null => {
  const logs = placed.filter((l) => !l.onBench && !isBoard(l.kind) && !isUpright(frameOf(l)));
  let best: { mid: THREE.Vector3; dir: THREE.Vector3; d: number } | null = null;
  for (let a = 0; a < logs.length; a++) {
    for (let b = a + 1; b < logs.length; b++) {
      const A = frameOf(logs[a]), B = frameOf(logs[b]);
      const ax = horizontal(A.axis);
      if (Math.abs(ax.dot(horizontal(B.axis))) < 0.9) continue;
      const ta = A.center.y + logs[a].radius, tb = B.center.y + logs[b].radius;
      if (Math.abs(ta - tb) > 0.12) continue;
      // Where the board crosses each log: the points on their lines nearest the aim, kept on the logs.
      const onA = A.center.clone().addScaledVector(ax, THREE.MathUtils.clamp(p.clone().sub(A.center).dot(ax), -logs[a].length / 2, logs[a].length / 2));
      const onB = B.center.clone().addScaledVector(ax, THREE.MathUtils.clamp(p.clone().sub(B.center).dot(ax), -logs[b].length / 2, logs[b].length / 2));
      const across = onB.clone().sub(onA).setY(0);
      const gap = Math.abs(across.dot(new THREE.Vector3(-ax.z, 0, ax.x)));
      if (gap < 0.4 || gap > len + 0.1) continue;
      const mid = onA.clone().add(onB).multiplyScalar(0.5).setY(Math.max(ta, tb));
      const d = Math.hypot(mid.x - p.x, mid.z - p.z);
      if (d > gap / 2 + 0.8 || (best && d > best.d)) continue;
      const perp = new THREE.Vector3(-ax.z, 0, ax.x);
      best = { mid, dir: perp.multiplyScalar(Math.sign(across.dot(perp)) || 1), d };
    }
  }
  return best ? { mid: best.mid, dir: best.dir } : null;
};

/**
 * Across two uprights: the nearest other post or standing board with its top
 * level with `t`'s, close enough for a piece of length `len` to reach both
 * (preferring the one across the view). Returns the midpoint and direction.
 */
const spanFrom = (i: SnapInput, t: LogData, tf: PieceFrame, len: number): { mid: THREE.Vector3; dir: THREE.Vector3 } | null => {
  const top = topOf(t, tf);
  const view = horizontal(i.view);
  const across = new THREE.Vector3(-view.z, 0, view.x);
  let best: { c: THREE.Vector3; score: number } | null = null;
  for (const l of i.placed) {
    if (l.id === t.id || l.onBench || l.kind === 'door') continue;
    const lf = frameOf(l);
    if (!isUpright(lf) || Math.abs(topOf(l, lf) - top) > 0.15) continue;
    const d = lf.center.clone().sub(tf.center).setY(0);
    const dist = d.length();
    if (dist < 0.4 || dist > len + 0.1) continue;
    const score = Math.abs(d.normalize().dot(across)) - dist * 0.05;
    if (!best || score > best.score) best = { c: lf.center.clone(), score };
  }
  if (!best) return null;
  const mid = tf.center.clone().add(best.c).multiplyScalar(0.5);
  mid.y = top;
  return { mid, dir: best.c.clone().sub(tf.center).setY(0).normalize() };
};

/** Next board beside a board of the same set (same slope/stance), bottom ends aligned. */
const besideBoard = (i: SnapInput, t: LogData): Placement => {
  const f = frameOf(t);
  const k = i.point.clone().sub(f.center).dot(f.width) >= 0 ? 1 : -1;
  const pos = f.center.clone()
    .addScaledVector(f.width, k * (t.radius + i.carried.radius + BOARD_GAP))
    .addScaledVector(f.axis, (i.carried.length - t.length) / 2);
  return { position: pos, rotation: f.q.clone(), valid: true };
};

/** Which placement set a board belongs to. */
const boardStance = (f: PieceFrame): PlaceMode => (isUpright(f) ? 'standing' : isFlatFace(f) ? 'flat' : 'pitched');

const placeBoard = (i: SnapInput): Placement => {
  const c = i.carried;
  const t = i.target;
  const half = pieceHalfDepth(c);
  const mode = i.mode;
  // A plank near a pair of bench legs is the table top, whichever way it was
  // set (after two standing legs the plank is still "standing": nobody wants
  // a third leg stacked on a leg).
  if (c.kind === 'plank' && mode !== 'pitched') {
    const legs = benchLegPairNear(i.placed, i.point, c.length);
    if (legs) return { position: legs.mid.addScaledVector(UP, half), rotation: lyingQuat(legs.dir), valid: true };
  }
  // A flat board aimed at one of two level parallel logs lies across both
  // (sawhorse bench, floor joists).
  if (mode === 'flat' && t && !isBoard(t.kind) && !isUpright(frameOf(t))) {
    const pair = logPairNear(i.placed, i.point, c.length);
    if (pair) return { position: pair.mid.addScaledVector(UP, half), rotation: lyingQuat(pair.dir), valid: true };
  }
  if (t && isBoard(t.kind) && t.kind !== 'door' && boardStance(frameOf(t)) === mode) return besideBoard(i, t);
  if (t && mode === 'pitched' && c.kind === 'roof') {
    const tf = frameOf(t);
    if (!isBoard(t.kind) && !isUpright(tf)) return placeEave(i, t);
  }
  const across = acrossDir(i, i.point);
  if (mode === 'standing') {
    if (t) {
      const tf = frameOf(t);
      if (!isUpright(tf)) {
        // On a sill log or a flat board: stand on its line, face along it.
        const a = horizontal(tf.axis);
        const along = THREE.MathUtils.clamp(i.point.clone().sub(tf.center).dot(a), -t.length / 2, t.length / 2);
        const p = tf.center.clone().addScaledVector(a, along);
        p.y = topOf(t, tf) + c.length / 2;
        return { position: p, rotation: uprightQuat(a), valid: true };
      }
      const p = tf.center.clone();
      p.y = topOf(t, tf) + c.length / 2;
      return { position: p, rotation: uprightQuat(across), valid: true };
    }
    const leg = partnerLegSpot(i);
    const paired = leg ? pairLegs(i, leg) : null;
    if (paired) return paired;
    const lv = levelWithNeighbour(i, i.point.clone().addScaledVector(UP, c.length / 2 - BOARD_SINK));
    return { position: lv.position, rotation: uprightQuat(across), valid: i.normal.y > 0.6, adjust: lv.adjust };
  }
  // A flat board near a pair of level legs becomes a table top across them,
  // wherever it is aimed (not only at a leg's thin top edge).
  if (mode === 'flat' && !(t && isBoard(t.kind) && boardStance(frameOf(t)) === 'flat')) {
    const pair = uprightPairNear(i, i.point, c.length);
    if (pair) return { position: pair.mid.addScaledVector(UP, half), rotation: lyingQuat(pair.dir), valid: true };
  }
  // Flat or pitched: length across the view.
  let rot = lyingQuat(across);
  if (mode === 'pitched') rot = rot.multiply(new THREE.Quaternion().setFromAxisAngle(UP, 0.52));
  if (t) {
    const tf = frameOf(t);
    // A flat board on a leg reaches across to the other leg: a table top.
    const span = mode === 'flat' && isUpright(tf) ? spanFrom(i, t, tf, c.length) : null;
    if (span) return { position: span.mid.addScaledVector(UP, half), rotation: lyingQuat(span.dir), valid: true };
    const p = new THREE.Vector3(i.point.x, topOf(t, tf) + half + (mode === 'pitched' ? c.radius * 0.5 : 0), i.point.z);
    return { position: p, rotation: rot, valid: true };
  }
  return { position: i.point.clone().addScaledVector(UP, half + (mode === 'pitched' ? c.radius * 0.5 : 0)), rotation: rot, valid: i.normal.y > 0.6 };
};

const placeTimber = (i: SnapInput): Placement => {
  const c = i.carried;
  const t = i.target;
  const r = c.radius;
  const len = c.length;
  if (i.mode === 'upright') {
    if (t) {
      const tf = frameOf(t);
      if (isUpright(tf)) {
        const p = tf.center.clone();
        p.y = topOf(t, tf) + len / 2;
        return { position: p, rotation: tf.q.clone(), valid: true };
      }
      const a = horizontal(tf.axis);
      const along = THREE.MathUtils.clamp(i.point.clone().sub(tf.center).dot(a), -t.length / 2, t.length / 2);
      const p = isBoard(t.kind) ? i.point.clone() : tf.center.clone().addScaledVector(a, along);
      p.y = topOf(t, tf) + len / 2;
      return { position: p, rotation: uprightQuat(a), valid: true };
    }
    const leg = cornerPostSpot(i);
    const lv = levelWithNeighbour(i, leg ? leg.position : i.point.clone().addScaledVector(UP, len / 2 - SINK));
    return { position: lv.position, rotation: leg ? leg.rotation : uprightQuat(acrossDir(i, i.point)), valid: i.normal.y > 0.6, adjust: lv.adjust };
  }
  // Lying.
  if (t) {
    const tf = frameOf(t);
    if (isUpright(tf)) {
      // On a post: span to the nearest post at the same height, else sit centred.
      const top = topOf(t, tf);
      const span = spanFrom(i, t, tf, len);
      if (span) {
        // A sill across two posts. If the other pair of sills already rests on
        // these posts, this one crosses them at a notched corner, half a log up.
        const pos = span.mid.addScaledVector(UP, r);
        const ends = [tf.center.clone(), tf.center.clone().addScaledVector(span.dir, span.mid.clone().setY(tf.center.y).distanceTo(tf.center) * 2)];
        let rest = -Infinity;
        let restR = 0;
        let restNotched = false;
        for (const l of i.placed) {
          if (l.onBench || isBoard(l.kind)) continue;
          const lf = frameOf(l);
          if (isUpright(lf) || Math.abs(horizontal(lf.axis).dot(span.dir)) > 0.3) continue;
          if (lf.center.y < top || lf.center.y > top + 1.2) continue;
          const onPost = ends.some((e) => {
            const d = e.clone().sub(lf.center).setY(0);
            const along = THREE.MathUtils.clamp(d.dot(horizontal(lf.axis)), -l.length / 2, l.length / 2);
            return d.addScaledVector(horizontal(lf.axis), -along).length() < 0.3;
          });
          if (onPost && lf.center.y > rest) { rest = lf.center.y; restR = l.radius; restNotched = (l.notches ?? 'none') !== 'none'; }
        }
        if (rest > -Infinity) {
          const mine = (c.kind ?? 'log') === 'log' && (c.notches ?? 'none') !== 'none';
          pos.y = rest + (mine && restNotched ? 0.5 : mine || restNotched ? 0.75 : 1) * (restR + r);
        }
        return { position: pos, rotation: lyingQuat(span.dir), valid: true };
      }
      const p = tf.center.clone();
      p.y = top + r;
      return { position: p, rotation: lyingQuat(acrossDir(i, i.point)), valid: true };
    }
    if (isBoard(t.kind)) {
      const p = new THREE.Vector3(i.point.x, topOf(t, tf) + r, i.point.z);
      return { position: p, rotation: lyingQuat(acrossDir(i, i.point)), valid: true };
    }
    const a = horizontal(tf.axis);
    const along = i.point.clone().sub(tf.center).dot(a);
    const rT = t.radius;
    // Near an end, turn the corner, unless that end is the free (un-notched)
    // end of a notched log: that is a doorway jamb, so stack on it instead.
    const nearEnd = Math.abs(along) > t.length * 0.3;
    const cornerEnd = (t.notches ?? 'none') === 'none' || notchedAt(t, Math.sign(along));
    if (nearEnd && cornerEnd) {
      // Turn the corner: cross the target's end at right angles.
      const s = Math.sign(along);
      const cross = tf.center.clone().addScaledVector(a, s * (t.length / 2 - notchInset(t)));
      const b = new THREE.Vector3().crossVectors(a, UP).normalize();
      const side = i.point.clone().sub(tf.center).dot(b) >= 0 ? 1 : -1;
      const center = cross.clone().addScaledVector(b, side * (len / 2 - notchInset(c)));
      // The carried log's +Y end (its notched end, if only one) goes into the corner.
      const toCorner = b.clone().multiplyScalar(-side);
      const mine = (c.kind ?? 'log') === 'log' && (c.notches === 'both' || c.notches === 'one');
      const theirs = notchedAt(t, s);
      const rise = (mine && theirs ? 0.5 : mine || theirs ? 0.75 : 1) * (rT + r);
      // Under the crossing log if there is room above the ground and nothing
      // lies there already, else over it, else the next free course up.
      // Opposite walls then share courses and the other two sit half a log
      // off (a closed square, not a spiral that leaves the third and fourth
      // walls hanging off the ground), and aiming at any log in a corner
      // stack adds to it rather than into a log already there.
      const axisDir = toCorner.clone();
      const fits = (y: number): boolean => {
        const at = center.clone().setY(y);
        for (const k of [-0.5, 0, 0.5]) {
          const p = at.clone().addScaledVector(axisDir, k * len);
          // A log may bed a little into the soil (up to 0.6 r), not sink into it.
          if (y - r < i.groundAt(p.x, p.z) - 0.6 * r) return false;
        }
        return !i.placed.some((l) => {
          if (l.id === t.id || l.onBench || isBoard(l.kind)) return false;
          const lf = frameOf(l);
          if (isUpright(lf) || Math.abs(horizontal(lf.axis).dot(axisDir)) < 0.95) return false;
          const d = lf.center.clone().sub(at);
          const along = Math.abs(d.dot(axisDir));
          const off = d.clone().addScaledVector(axisDir, -d.dot(axisDir)).length();
          return along < (len + l.length) / 2 - 0.05 && off < (r + l.radius) * 0.9;
        });
      };
      const step = (rT + r) * 0.975;
      const slots = [tf.center.y - rise, tf.center.y + rise, tf.center.y + rise + step, tf.center.y + rise + 2 * step];
      center.y = slots.find(fits) ?? slots[1];
      return { position: center, rotation: lyingQuat(toCorner), valid: true };
    }
    // Next course: same line, ends flush with the end nearest the aim. A
    // longer log over a doorway log (notched one end) lines up with its
    // corner end, so it bridges the doorway rather than overhanging the corner.
    let s = Math.abs(along) < 0.05 ? 0 : Math.sign(along);
    if (t.notches === 'one' && len > t.length + 0.05) s = 1;
    const center = tf.center.clone().addScaledVector(a, s * (t.length / 2 - len / 2));
    center.y = tf.center.y + rT + r * 0.95;
    // A log notched at one end keeps its notch at the corner.
    const notchSide = t.notches === 'one' ? 1 : (s || 1);
    return { position: center, rotation: lyingQuat(c.notches === 'one' ? a.clone().multiplyScalar(notchSide) : a), valid: true };
  }
  // On bare ground: rest on the highest ground under it (never half buried);
  // on a slope the low end stands off the ground.
  const dir = acrossDir(i, i.point);
  let high = i.point.y;
  for (const k of [-0.5, -0.25, 0.25, 0.5]) {
    const at = i.point.clone().addScaledVector(dir, k * len);
    high = Math.max(high, i.groundAt(at.x, at.z));
  }
  return { position: i.point.clone().setY(high + r * 0.85), rotation: lyingQuat(dir), valid: i.normal.y > 0.45 };
};

export function computePlacement(i: SnapInput): Placement {
  const bench = i.target ? i.benches.find((b) => b.id === i.target!.id) : undefined;
  if (bench) return placeOnBench(i, bench);
  const kind = i.carried.kind ?? 'log';
  if (kind === 'door') return placeDoor(i);
  if (isBoard(kind)) return placeBoard(i);
  return placeTimber(i);
}
