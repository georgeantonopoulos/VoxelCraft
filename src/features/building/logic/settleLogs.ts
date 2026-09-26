import * as THREE from 'three';
import { PLANK_THICKNESS, type LogData } from '@/state/LogStore';

/**
 * Re-seat saved logs on terrain that changed under them (a new generator
 * version reshapes the ground, and builds were left floating or buried).
 *
 * Placed logs are grouped into builds (logs that touch), and each build moves
 * vertically as one piece so it rests on the new ground the way it rested on
 * the old: walls, corners and roofs keep their shape. Loose logs are lifted
 * out of ground that now covers them. Pure; the caller passes ground height.
 */

const UP = new THREE.Vector3(0, 1, 0);
/** How far a post is sunk into the ground when placed (BuildPreview SINK). */
const POST_SINK = 0.12;
/** Smaller differences are ordinary slope, not a changed world. */
const MIN_SHIFT = 0.25;

interface Seg { a: THREE.Vector3; b: THREE.Vector3; r: number; upright: boolean }

const segmentOf = (l: LogData): Seg => {
  const q = new THREE.Quaternion(l.rotation[0], l.rotation[1], l.rotation[2], l.rotation[3]);
  const axis = UP.clone().applyQuaternion(q);
  const c = new THREE.Vector3(...l.position);
  const half = l.length / 2;
  const r = l.kind === 'plank' ? PLANK_THICKNESS / 2 : l.radius;
  return { a: c.clone().addScaledVector(axis, -half), b: c.clone().addScaledVector(axis, half), r, upright: Math.abs(axis.y) > 0.8 };
};

/** Closest distance between two segments. */
const segDist = (p: Seg, q: Seg): number => {
  const d1 = p.b.clone().sub(p.a), d2 = q.b.clone().sub(q.a), r = p.a.clone().sub(q.a);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a < 1e-9 && e < 1e-9) return p.a.distanceTo(q.a);
  if (a < 1e-9) { t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e < 1e-9) { s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  return p.a.clone().addScaledVector(d1, s).distanceTo(q.a.clone().addScaledVector(d2, t));
};

/** Lowest point of a log and the ground under it; returns the gap (+ floating, - buried) beyond its intended sink. */
const groundGap = (l: LogData, seg: Seg, groundAt: (x: number, z: number) => number): number => {
  if (seg.upright) {
    const foot = seg.a.y < seg.b.y ? seg.a : seg.b;
    return foot.y - (groundAt(foot.x, foot.z) - POST_SINK);
  }
  // Lying: sample along it and take the highest ground (where it rests).
  let ground = -Infinity;
  for (let k = 0; k <= 4; k++) {
    const p = seg.a.clone().lerp(seg.b, k / 4);
    ground = Math.max(ground, groundAt(p.x, p.z));
  }
  const lowest = Math.min(seg.a.y, seg.b.y) - seg.r;
  // Placed lying logs sit ~0.15 r into the ground (BuildPreview: r * 0.85 above the hit).
  return lowest - (ground - 0.15 * seg.r);
};

export function settleLogs(logs: LogData[], groundAt: (x: number, z: number) => number): LogData[] {
  const placed = logs.filter((l) => l.state === 'placed');
  const segs = new Map(placed.map((l) => [l.id, segmentOf(l)]));

  // Builds: connected groups of touching placed logs.
  const group = new Map<string, number>();
  let groups = 0;
  for (const l of placed) {
    if (group.has(l.id)) continue;
    const g = groups++;
    const stack = [l];
    group.set(l.id, g);
    while (stack.length) {
      const cur = stack.pop()!;
      const cs = segs.get(cur.id)!;
      for (const o of placed) {
        if (group.has(o.id)) continue;
        const os = segs.get(o.id)!;
        if (segDist(cs, os) <= cs.r + os.r + 0.15) { group.set(o.id, g); stack.push(o); }
      }
    }
  }

  // Each build moves by the median gap of the logs that bear on the ground
  // (those within 1 m of its lowest point).
  const shift = new Map<number, number>();
  for (let g = 0; g < groups; g++) {
    const members = placed.filter((l) => group.get(l.id) === g);
    const lows = members.map((l) => { const s = segs.get(l.id)!; return Math.min(s.a.y, s.b.y) - (s.upright ? 0 : s.r); });
    const floor = Math.min(...lows);
    const gaps = members.filter((_, i) => lows[i] <= floor + 1.0).map((l) => groundGap(l, segs.get(l.id)!, groundAt)).sort((x, y) => x - y);
    const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
    shift.set(g, Math.abs(median) >= MIN_SHIFT ? -median : 0);
  }

  return logs.map((l) => {
    if (l.state === 'placed') {
      const dy = shift.get(group.get(l.id)!) ?? 0;
      return dy ? { ...l, position: [l.position[0], l.position[1] + dy, l.position[2]] } : l;
    }
    if (l.state === 'loose') {
      // Out of any ground that rose over it; physics drops it onto the rest.
      const g = groundAt(l.position[0], l.position[2]);
      const minY = g + l.radius + 0.25;
      return l.position[1] < minY ? { ...l, position: [l.position[0], minY, l.position[2]] } : l;
    }
    return l;
  });
}
