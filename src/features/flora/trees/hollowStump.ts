import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The dormant Root Hollow: the broken stump of an ancient tree. A thick bark
 * shell with a jagged, blunt broken top (one side standing taller), hollow
 * inside down to a dark floor where a little Lumina still glows, and six
 * five buttress roots that flare from the base and dive into the ground before
 * they end (no visible root tips: pointed tips read as claws).
 *
 * Three geometries, all in the stump's local frame with the ground at
 * y = HOLLOW_GROUND_Y (the instance sits that far below the surface):
 * - bark: outer shell, broken rim and roots, with the tree bark attributes
 *   (aBranchDepth/Axis/Origin) so it shares the trees' bark material;
 * - inner: the inside wall, vertex coloured from bark-dark at the rim to
 *   near-black at the floor;
 * - floor: the bottom of the hollow (glows faintly).
 */

export const HOLLOW_GROUND_Y = 0.3;
/** Collider for the stump body (local, ground-relative). */
export const HOLLOW_STUMP_RADIUS = 0.82;
export const HOLLOW_STUMP_HEIGHT = 1.75;

const COLS = 48;
const ROOTS = 5;
const TAU = Math.PI * 2;
const FLOOR_Y = 0.4; // above ground
const SHELL = 0.15;  // wall thickness at the rim

const angDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

// Root directions: evenly spread with a fixed jitter (one geometry serves every hollow; instances turn it).
const ROOT_ANGLES = Array.from({ length: ROOTS }, (_, i) => (i / ROOTS) * TAU + Math.sin(i * 2.7 + 0.4) * 0.28);

/** How strongly a root lobe swells the base at this angle (0..1). */
const lobe = (a: number) => {
  let m = 0;
  for (const r of ROOT_ANGLES) m = Math.max(m, Math.exp(-(angDiff(a, r) ** 2) / 0.05));
  return m;
};

/** Height of the broken top above ground: rounded, uneven, one taller splintered side. */
const rimHeight = (a: number) =>
  1.3 + 0.16 * Math.sin(a * 2 + 0.7) + 0.06 * Math.sin(a * 5 + 2.1) + 0.03 * Math.sin(a * 11 + 0.3)
  + 0.3 * Math.exp(-(angDiff(a, 1.1) ** 2) / 0.16);

/** Plain trunk radius at a height above ground (no root flare). */
const trunkRadius = (h: number) => 0.74 - 0.05 * Math.min(1, Math.max(0, h) / 1.8);

/** Outer bark radius with the root flare near the ground and shallow bark ridges. */
const outerRadius = (a: number, h: number) => {
  const flare = Math.exp(-Math.max(0, h) * 2.0) * (0.22 + 0.75 * lobe(a));
  return trunkRadius(h) * (1 + flare) * (1 + 0.025 * Math.sin(a * 13 + h * 1.7));
};

interface Piece {
  pos: number[];
  idx: number[];
  axis: number[];
  origin: number[];
}

const newPiece = (): Piece => ({ pos: [], idx: [], axis: [], origin: [] });

const toGeometry = (p: Piece, withBark: boolean): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
  g.setIndex(p.idx);
  g.computeVertexNormals();
  const n = p.pos.length / 3;
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (withBark) {
    g.setAttribute('aBranchDepth', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aBranchAxis', new THREE.Float32BufferAttribute(p.axis, 3));
    g.setAttribute('aBranchOrigin', new THREE.Float32BufferAttribute(p.origin, 3));
  }
  return g;
};

/** Outer shell and broken rim (one piece so the rim edge shades smoothly into the bark). */
const buildShell = (): Piece => {
  const p = newPiece();
  const ROWS = 16;
  const push = (x: number, y: number, z: number) => {
    p.pos.push(x, y, z);
    p.axis.push(0, 1, 0);
    p.origin.push(0, 0, 0);
  };
  // Outer wall: rows from below ground up to each column's broken top.
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = (i / COLS) * TAU;
      const top = rimHeight(a);
      const h = -0.5 + (top + 0.5) * (j / ROWS);
      const r = outerRadius(a, h);
      push(Math.cos(a) * r, h, Math.sin(a) * r);
    }
  }
  // Rim: a rounded lip from the outer top edge over to the inner wall.
  const LIP = 3;
  for (let k = 1; k <= LIP; k++) {
    const t = k / LIP;
    for (let i = 0; i < COLS; i++) {
      const a = (i / COLS) * TAU;
      const top = rimHeight(a);
      const ro = outerRadius(a, top);
      const r = ro - SHELL * t;
      const h = top + Math.sin(t * Math.PI) * 0.035 - t * 0.06 + 0.02 * Math.sin(a * 17);
      push(Math.cos(a) * r, h, Math.sin(a) * r);
    }
  }
  const rows = ROWS + LIP;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < COLS; i++) {
      const i2 = (i + 1) % COLS;
      const a = j * COLS + i, b = j * COLS + i2, c = (j + 1) * COLS + i, d = (j + 1) * COLS + i2;
      p.idx.push(a, c, b, b, c, d);
    }
  }
  return p;
};

/** One buttress root: flattened (tall, narrow) near the trunk, rounder as it dives underground. */
const buildRoot = (angle: number, i: number): Piece => {
  const p = newPiece();
  const STEPS = 10, SIDES = 10;
  const len = 0.95 + 0.4 * (0.5 + 0.5 * Math.sin(i * 1.9 + 0.5));
  const pts: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    const d = 0.45 + len * t;
    const a = angle + Math.sin(t * 3.1 + i) * 0.06;
    const h = 0.42 - 0.45 * t - 0.75 * t * t; // ends ~0.8 m underground
    pts.push(new THREE.Vector3(Math.cos(a) * d, h, Math.sin(a) * d));
    radii.push(0.27 * (1 - 0.55 * t));
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    const dir = (s < STEPS ? pts[s + 1].clone().sub(pts[s]) : pts[s].clone().sub(pts[s - 1])).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const vUp = new THREE.Vector3().crossVectors(side, dir).normalize();
    const hy = 1.6 - 0.6 * t; // tall fin near the trunk
    const hx = 0.62 + 0.38 * t;
    const segStart = pts[Math.max(0, s - 1)];
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * TAU;
      const r = radii[s] * (1 + 0.05 * Math.sin(a * 3 + s));
      const v = pts[s].clone()
        .addScaledVector(side, Math.cos(a) * r * hx)
        .addScaledVector(vUp, Math.sin(a) * r * hy);
      p.pos.push(v.x, v.y, v.z);
      p.axis.push(dir.x, dir.y, dir.z);
      p.origin.push(segStart.x, segStart.y, segStart.z);
    }
  }
  for (let s = 0; s < STEPS; s++) {
    for (let k = 0; k < SIDES; k++) {
      const k2 = (k + 1) % SIDES;
      const a = s * SIDES + k, b = s * SIDES + k2, c = (s + 1) * SIDES + k, d = (s + 1) * SIDES + k2;
      p.idx.push(a, c, b, b, c, d);
    }
  }
  // Rounded end cap (buried, but closed in case a slope uncovers it).
  const end = pts[STEPS];
  const dirEnd = end.clone().sub(pts[STEPS - 1]).normalize();
  const tip = end.clone().addScaledVector(dirEnd, radii[STEPS] * 0.8);
  const tipIdx = p.pos.length / 3;
  p.pos.push(tip.x, tip.y, tip.z);
  p.axis.push(dirEnd.x, dirEnd.y, dirEnd.z);
  p.origin.push(end.x, end.y, end.z);
  for (let k = 0; k < SIDES; k++) {
    const k2 = (k + 1) % SIDES;
    p.idx.push(STEPS * SIDES + k2, STEPS * SIDES + k, tipIdx);
  }
  return p;
};

/** Inside wall, from the rim's inner edge down to the floor; normals face inward. */
const buildInner = (): { geo: THREE.BufferGeometry } => {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const ROWS = 8;
  const rimCol = new THREE.Color('#3a2e22');
  const deepCol = new THREE.Color('#0b0908');
  const c = new THREE.Color();
  for (let j = 0; j <= ROWS; j++) {
    const t = j / ROWS; // 0 at the rim, 1 at the floor
    for (let i = 0; i < COLS; i++) {
      const a = (i / COLS) * TAU;
      const top = rimHeight(a) - 0.06 + 0.02 * Math.sin(a * 17);
      const h = top + (FLOOR_Y - top) * t;
      const rTop = outerRadius(a, rimHeight(a)) - SHELL;
      const r = rTop * (1 - 0.1 * t * t) * (1 + 0.03 * Math.sin(a * 7 + h * 3));
      pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
      c.copy(rimCol).lerp(deepCol, Math.pow(t, 0.6));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const i2 = (i + 1) % COLS;
      const a = j * COLS + i, b = j * COLS + i2, cc = (j + 1) * COLS + i, d = (j + 1) * COLS + i2;
      idx.push(a, cc, b, b, cc, d); // wound to face the axis
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo };
};

/** The hollow's floor: a shallow bowl of old heartwood and leaf mould. */
const buildFloor = (): THREE.BufferGeometry => {
  const r = (outerRadius(0, rimHeight(0)) - SHELL) * 0.92;
  const g = new THREE.CircleGeometry(r, COLS);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.sqrt(x * x + z * z) / r;
    p.setY(i, FLOOR_Y - 0.08 * (1 - d * d) + 0.012 * Math.sin(x * 19) * Math.sin(z * 17));
  }
  g.computeVertexNormals();
  return g;
};

export interface HollowStumpGeometry {
  bark: THREE.BufferGeometry;
  inner: THREE.BufferGeometry;
  floor: THREE.BufferGeometry;
}

let cached: HollowStumpGeometry | null = null;

export const getHollowStumpGeometry = (): HollowStumpGeometry => {
  if (cached) return cached;
  const pieces = [buildShell(), ...ROOT_ANGLES.map((a, i) => buildRoot(a, i))].map((p) => toGeometry(p, true));
  const bark = mergeGeometries(pieces, false)!;
  pieces.forEach((g) => g.dispose());
  const { geo: inner } = buildInner();
  const floor = buildFloor();
  for (const g of [bark, inner, floor]) {
    g.translate(0, HOLLOW_GROUND_Y, 0);
    g.computeBoundingSphere();
  }
  cached = { bark, inner, floor };
  return cached;
};
