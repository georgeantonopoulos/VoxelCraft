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
 * A post or standing board set on the ground near another of its kind
 * levels its top with it (sunk deeper or standing proud by up to 35 cm), so
 * bench legs, frame posts and board walls line up on sloping ground.
 */
const LEVEL_REACH = 1.8;
const LEVEL_SPAN = 0.35;
const levelWithNeighbour = (i: SnapInput, pos: THREE.Vector3): THREE.Vector3 => {
  const c = i.carried;
  const board = isBoard(c.kind);
  let best: { top: number; d: number } | null = null;
  for (const l of i.placed) {
    if (l.onBench || isBoard(l.kind) !== board || l.kind === 'door') continue;
    const f = frameOf(l);
    if (!isUpright(f)) continue;
    const d = Math.hypot(f.center.x - pos.x, f.center.z - pos.z);
    if (d > LEVEL_REACH || (best && d > best.d)) continue;
    best = { top: f.center.y + l.length / 2, d };
  }
  if (!best) return pos;
  const shift = best.top - (pos.y + c.length / 2);
  return Math.abs(shift) <= LEVEL_SPAN ? pos.clone().setY(pos.y + shift) : pos;
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
    const p = levelWithNeighbour(i, i.point.clone().addScaledVector(UP, c.length / 2 - BOARD_SINK));
    return { position: p, rotation: uprightQuat(across), valid: i.normal.y > 0.6 };
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
    const p = levelWithNeighbour(i, i.point.clone().addScaledVector(UP, len / 2 - SINK));
    return { position: p, rotation: uprightQuat(acrossDir(i, i.point)), valid: i.normal.y > 0.6 };
  }
  // Lying.
  if (t) {
    const tf = frameOf(t);
    if (isUpright(tf)) {
      // On a post: span to the nearest post at the same height, else sit centred.
      const top = topOf(t, tf);
      const span = spanFrom(i, t, tf, len);
      if (span) return { position: span.mid.addScaledVector(UP, r), rotation: lyingQuat(span.dir), valid: true };
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
          if (y - r < i.groundAt(p.x, p.z) - 0.25 * r) return false;
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
  return { position: i.point.clone().addScaledVector(UP, r * 0.85), rotation: lyingQuat(acrossDir(i, i.point)), valid: i.normal.y > 0.45 };
};

export function computePlacement(i: SnapInput): Placement {
  const bench = i.target ? i.benches.find((b) => b.id === i.target!.id) : undefined;
  if (bench) return placeOnBench(i, bench);
  const kind = i.carried.kind ?? 'log';
  if (kind === 'door') return placeDoor(i);
  if (isBoard(kind)) return placeBoard(i);
  return placeTimber(i);
}
