import * as THREE from 'three';
import { pieceHalfDepth, type LogData } from '@/state/LogStore';
import { frameOf, isUpright, type PieceFrame } from './pieceFrame';

/**
 * What holds a build up (pure). A placed piece is supported when the ground
 * or other supported pieces carry it:
 * - an upright piece (post, standing board) needs something under its foot;
 * - a lying piece (log, beam, floor board) needs support under its middle,
 *   or on both sides of it; held at one end only it tips and falls;
 * - a roof board hangs from its eave, a door from its jamb: any support will do;
 * - a door carries nothing.
 * Support flows up from the ground: the supported set is grown to a fixed
 * point. Pieces waiting on a workbench are held by the bench.
 */

/** Ground height near (x, z), looking around height `nearY` (null: no ground there). */
export type GroundAt = (x: number, z: number, nearY: number) => number | null;

/** Gap under a piece that still counts as resting on the ground (slightly uneven ground). */
export const GROUND_TOLERANCE = 0.25;
/** Gap between two pieces that still counts as one resting on the other. */
const CONTACT_TOLERANCE = 0.08;
/** A lying piece held this close to its middle (fraction of its length) is balanced; further out it tips. */
const MIDDLE = 0.06;
/** Samples along a lying piece (ends and between). */
const SAMPLES = [-0.5, -0.25, 0, 0.25, 0.5];

interface Shape { f: PieceFrame; half: number; upright: boolean; len: number }

const shapeOf = (l: LogData): Shape => {
  const f = frameOf(l);
  return { f, half: pieceHalfDepth(l), upright: isUpright(f), len: l.length };
};

/** How far below its axis a lying piece's underside reaches. */
const underside = (l: LogData, s: Shape): number => {
  if (l.kind === 'plank' || l.kind === 'roof' || l.kind === 'door') {
    return Math.abs(s.f.normal.y) * s.half + Math.abs(s.f.width.y) * l.radius + 0.001;
  }
  return l.radius;
};

/** Closest distance from a point to a piece's axis segment. */
const distToAxis = (p: THREE.Vector3, s: Shape): number => {
  const d = p.clone().sub(s.f.center);
  const t = THREE.MathUtils.clamp(d.dot(s.f.axis), -s.len / 2, s.len / 2);
  return s.f.center.clone().addScaledVector(s.f.axis, t).distanceTo(p);
};

/** Thickness of a piece across its axis, toward a point (round/square: radius; boards: roughly half their width). */
const reach = (l: LogData, s: Shape): number => (l.kind === 'plank' || l.kind === 'roof' || l.kind === 'door' ? Math.max(s.half, l.radius) : l.radius);

/**
 * Is `piece` held up by the ground or by pieces in `supporters`?
 * `supporters` should hold only pieces already known to be supported.
 */
export function isHeld(piece: LogData, supporters: LogData[], groundAt: GroundAt): boolean {
  if (piece.onBench) return true;
  const s = shapeOf(piece);
  // A door hangs on its hinges: it carries nothing (wall logs beside a doorway
  // are held by the wall, not by the door leaning against them).
  const others = supporters.filter((o) => o.id !== piece.id && o.kind !== 'door').map((o) => ({ o, s: shapeOf(o) }));
  const restsOnPiece = (p: THREE.Vector3, gap: number): boolean => others.some(({ o, s: os }) =>
    os.f.center.y < s.f.center.y + 0.05 && distToAxis(p, os) <= gap + reach(o, os) + CONTACT_TOLERANCE);
  const onGround = (p: THREE.Vector3): boolean => {
    const g = groundAt(p.x, p.z, p.y);
    return g !== null && p.y - g <= GROUND_TOLERANCE;
  };

  if (s.upright) {
    // Its foot: the lower end.
    const foot = s.f.center.clone().addScaledVector(s.f.axis, (s.f.axis.y > 0 ? -1 : 1) * s.len / 2);
    return onGround(foot) || restsOnPiece(foot, 0.02);
  }

  // Lying or leaning: where along its length is it held?
  const under = underside(piece, s);
  const held: number[] = [];
  for (const k of SAMPLES) {
    const t = k * s.len;
    const at = s.f.center.clone().addScaledVector(s.f.axis, t);
    const bottom = at.clone().setY(at.y - under);
    if (onGround(bottom) || restsOnPiece(at, under)) held.push(t);
  }
  // Crossing pieces touch between samples (a post under a beam, a log across a wall).
  for (const { o, s: os } of others) {
    if (os.f.center.y >= s.f.center.y + 0.05) continue;
    const t = closestAlong(s, os);
    if (t === null) continue;
    const at = s.f.center.clone().addScaledVector(s.f.axis, t);
    if (distToAxis(at, os) <= under + reach(o, os) + CONTACT_TOLERANCE) held.push(t);
  }
  if (!held.length) return false;
  if (piece.kind === 'roof' || piece.kind === 'door') return true;
  const middle = MIDDLE * s.len;
  if (held.some((t) => Math.abs(t) <= middle)) return true;
  return Math.min(...held) < 0 && Math.max(...held) > 0;
}

/** Where along `a`'s axis it passes closest to `b`'s axis segment (null if parallel). */
const closestAlong = (a: Shape, b: Shape): number | null => {
  const d1 = a.f.axis, d2 = b.f.axis;
  const r = a.f.center.clone().sub(b.f.center);
  const bb = d1.dot(d2);
  const den = 1 - bb * bb;
  if (den < 1e-4) return null;
  const c = d1.dot(r), f = d2.dot(r);
  let s = (bb * f - c) / den;
  s = THREE.MathUtils.clamp(s, -a.len / 2, a.len / 2);
  // Keep the point on b's segment too, then back onto a's.
  const t = THREE.MathUtils.clamp(bb * s + f, -b.len / 2, b.len / 2);
  return THREE.MathUtils.clamp(bb * t - c, -a.len / 2, a.len / 2);
};

/** Every placed piece the ground holds up, directly or through others. */
export function supportedSet(placed: LogData[], groundAt: GroundAt): Set<string> {
  const supported = new Set<string>();
  const byId = new Map(placed.map((l) => [l.id, l]));
  let changed = true;
  while (changed) {
    changed = false;
    const holders = [...supported].map((id) => byId.get(id)!).filter(Boolean);
    for (const l of placed) {
      if (supported.has(l.id)) continue;
      if (isHeld(l, holders, groundAt)) { supported.add(l.id); changed = true; holders.push(l); }
    }
  }
  return supported;
}

/** Placed pieces within `radius` of `near` that nothing holds up any more. */
export function unsupportedNear(placed: LogData[], groundAt: GroundAt, near: THREE.Vector3, radius = 8): LogData[] {
  const held = supportedSet(placed, groundAt);
  return placed.filter((l) => !held.has(l.id) && Math.hypot(l.position[0] - near.x, l.position[2] - near.z) <= radius);
}

/** Debug: which pieces hold `id` up (window.__buildSupport.why(id, groundAt)). */
export function holdersOf(piece: LogData, supporters: LogData[], groundAt: GroundAt): { ground: number[]; pieces: string[] } {
  const s = shapeOf(piece);
  const under = s.upright ? 0 : underside(piece, s);
  const ground: number[] = [];
  for (const k of SAMPLES) {
    const at = s.f.center.clone().addScaledVector(s.f.axis, k * s.len);
    const g = groundAt(at.x, at.z, at.y - under);
    if (g !== null && at.y - under - g <= GROUND_TOLERANCE) ground.push(+(k * s.len).toFixed(2));
  }
  const pieces = supporters.filter((o) => o.id !== piece.id && isHeld(piece, [o], () => null)).map((o) => o.id);
  return { ground, pieces };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __buildSupport?: unknown }).__buildSupport = { isHeld, supportedSet, holdersOf };
}
