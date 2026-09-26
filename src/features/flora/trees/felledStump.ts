import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { speciesTrunk } from './treeGrowth';

/**
 * The stump a felled tree leaves: the base of its trunk (same radius and root
 * flare as the standing tree, in the tree's local units so the tree's instance
 * scale fits it) cut off at knee height by a slightly slanted axe cut. The
 * bark carries the tree bark attributes (aBranchDepth/Axis/Origin) so it
 * shares that species' bark material; the cut face is a separate geometry
 * for the growth-ring texture.
 */

const COLS = 20;
const TAU = Math.PI * 2;
const CUT = 0.5;   // cut height above ground (tree units)
const SLANT = 0.07; // rise across the cut, from the notch side to the hinge

export interface FelledStumpGeometry { bark: THREE.BufferGeometry; cut: THREE.BufferGeometry }

const cache = new Map<number, FelledStumpGeometry>();

export const getFelledStumpGeometry = (type: TreeType): FelledStumpGeometry => {
  const hit = cache.get(type);
  if (hit) return hit;
  const { radius: R0, buttress: b } = speciesTrunk(type);
  const radiusAt = (a: number, h: number) =>
    R0 * (1 + (0.25 + 0.35 * b) * Math.exp(-Math.max(0, h) * 3)) * (1 + 0.04 * Math.sin(a * 7 + h * 2));
  const topAt = (a: number) => CUT + SLANT * Math.cos(a) + 0.015 * Math.sin(a * 9);

  const pieces: THREE.BufferGeometry[] = [];
  const barkPiece = (pos: number[], idx: number[], axis: number[], origin: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const n = pos.length / 3;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aBranchDepth', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aBranchAxis', new THREE.Float32BufferAttribute(axis, 3));
    g.setAttribute('aBranchOrigin', new THREE.Float32BufferAttribute(origin, 3));
    pieces.push(g);
  };

  // Trunk shell, from below ground up to the cut.
  {
    const pos: number[] = [], idx: number[] = [], axis: number[] = [], origin: number[] = [];
    const ROWS = 6;
    for (let j = 0; j <= ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const a = (i / COLS) * TAU;
        const h = -0.3 + (topAt(a) + 0.3) * (j / ROWS);
        const r = radiusAt(a, h);
        pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
        axis.push(0, 1, 0); origin.push(0, 0, 0);
      }
    }
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const i2 = (i + 1) % COLS;
      const a = j * COLS + i, bb = j * COLS + i2, c = (j + 1) * COLS + i, d = (j + 1) * COLS + i2;
      idx.push(a, c, bb, bb, c, d);
    }
    barkPiece(pos, idx, axis, origin);
  }

  // Root flares (the same shape the standing tree has), diving underground.
  if (b > 0) {
    const roots = type === TreeType.JUNGLE ? 5 : 4;
    const SIDES = 8, STEPS = 5;
    for (let k = 0; k < roots; k++) {
      const a0 = (k / roots) * TAU + Math.sin(k * 2.3 + 0.7) * 0.25;
      const ca = Math.cos(a0), sa = Math.sin(a0);
      const len = 0.45 + b * 1.0, top = 0.2 + b * 0.45, r0 = R0 * (0.5 + 0.25 * b);
      const pts: THREE.Vector3[] = [], radii: number[] = [];
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        const d = R0 * 0.35 + len * t;
        pts.push(new THREE.Vector3(ca * d, top * Math.pow(1 - t, 1.6) - 0.45 * t, sa * d));
        radii.push(r0 * (1 - 0.5 * t));
      }
      const pos: number[] = [], idx: number[] = [], axis: number[] = [], origin: number[] = [];
      const up = new THREE.Vector3(0, 1, 0);
      for (let s = 0; s <= STEPS; s++) {
        const dir = (s < STEPS ? pts[s + 1].clone().sub(pts[s]) : pts[s].clone().sub(pts[s - 1])).normalize();
        const side = new THREE.Vector3().crossVectors(dir, up).normalize();
        const vUp = new THREE.Vector3().crossVectors(side, dir).normalize();
        const seg = pts[Math.max(0, s - 1)];
        for (let q = 0; q < SIDES; q++) {
          const ang = (q / SIDES) * TAU;
          const v = pts[s].clone().addScaledVector(side, Math.cos(ang) * radii[s]).addScaledVector(vUp, Math.sin(ang) * radii[s]);
          pos.push(v.x, v.y, v.z);
          axis.push(dir.x, dir.y, dir.z); origin.push(seg.x, seg.y, seg.z);
        }
      }
      for (let s = 0; s < STEPS; s++) for (let q = 0; q < SIDES; q++) {
        const q2 = (q + 1) % SIDES;
        const a = s * SIDES + q, bb = s * SIDES + q2, c = (s + 1) * SIDES + q, d = (s + 1) * SIDES + q2;
        idx.push(a, c, bb, bb, c, d);
      }
      barkPiece(pos, idx, axis, origin);
    }
  }

  const bark = mergeGeometries(pieces, false)!;
  pieces.forEach((g) => g.dispose());

  // The cut face: a fan over the top ring, UVs planar for the growth rings.
  const pos: number[] = [0, CUT, 0], uv: number[] = [0.5, 0.5], idx: number[] = [];
  const rim = radiusAt(0, CUT);
  for (let i = 0; i < COLS; i++) {
    const a = (i / COLS) * TAU;
    const r = radiusAt(a, topAt(a)) * 0.985;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pos.push(x, topAt(a) + 0.002, z);
    uv.push(0.5 + (x / rim) * 0.5, 0.5 + (z / rim) * 0.5);
  }
  for (let i = 0; i < COLS; i++) idx.push(0, 1 + ((i + 1) % COLS), 1 + i);
  const cut = new THREE.BufferGeometry();
  cut.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cut.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cut.setIndex(idx);
  cut.computeVertexNormals();

  bark.computeBoundingSphere();
  cut.computeBoundingSphere();
  const out = { bark, cut };
  cache.set(type, out);
  return out;
};

/** Collider size of a stump in tree units (radius, full height above ground). */
export const felledStumpCollider = (type: TreeType): { radius: number; height: number } => {
  const { radius } = speciesTrunk(type);
  return { radius: radius * 1.1, height: CUT };
};
