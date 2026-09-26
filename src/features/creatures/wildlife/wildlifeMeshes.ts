import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

/**
 * Procedural creature meshes + one vertex-animation material.
 *
 * Every creature faces +Z with its origin on the ground (walkers) or at its
 * centre (flyers, swimmers). Each vertex carries:
 *   aPart   which rig part it belongs to (see PART_*)
 *   aPivot  the joint it rotates around (hip, shoulder, neck, wing root)
 *   color   vertex colour (fur, feathers, scales)
 * Per instance (InstancedBufferAttribute, updated by WildlifeManager):
 *   aAnim   x: gait/flap phase (radians), y: amplitude, z: head-down 0..1, w: emissive glow
 * The shader animates parts procedurally, so hundreds of creatures cost one draw
 * call per species and no skeleton updates.
 */

export const PART_BODY = 0;
export const PART_WING_L = 1;
export const PART_WING_R = 2;
export const PART_LEG_FL = 3;
export const PART_LEG_FR = 4;
export const PART_LEG_BL = 5;
export const PART_LEG_BR = 6;
export const PART_HEAD = 7;
export const PART_TAIL = 8;
export const PART_GLOW = 9;
export const PART_SPROUT = 10;

export type CreatureKind = 'bird' | 'deer' | 'fish' | 'rootling';

function tag(geo: THREE.BufferGeometry, part: number, pivot: [number, number, number], color: THREE.ColorRepresentation, colorFn?: (y: number, x: number, z: number, c: THREE.Color) => void) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const pos = g.getAttribute('position');
  const parts = new Float32Array(n).fill(part);
  const pivots = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const base = new THREE.Color(color);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pivots[i * 3] = pivot[0]; pivots[i * 3 + 1] = pivot[1]; pivots[i * 3 + 2] = pivot[2];
    c.copy(base);
    colorFn?.(pos.getY(i), pos.getX(i), pos.getZ(i), c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(parts, 1));
  g.setAttribute('aPivot', new THREE.BufferAttribute(pivots, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

const ellipsoid = (rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 10) => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.floor(seg * 0.7)));
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
};

/** Tapered limb from `top` down by `len`, radius r0 -> r1. */
const limb = (r0: number, r1: number, len: number, x: number, top: number, z: number, seg = 6) => {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.translate(x, top - len / 2, z);
  return g;
};

interface LoftRing { p: [number, number, number]; rx: number; ry: number }

/**
 * Smooth tube along a spine with an elliptical cross-section per ring
 * (Catmull-Rom between rings). Used for deer torso, neck/head and legs so
 * they read as one continuous body instead of stacked ellipsoids.
 */
const loft = (rings: LoftRing[], seg = 12, sub = 4): THREE.BufferGeometry => {
  const curve = new THREE.CatmullRomCurve3(rings.map((r) => new THREE.Vector3(...r.p)), false, 'centripetal');
  const n = (rings.length - 1) * sub + 1;
  const verts: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    // Parametric (not arc-length) sampling keeps ring k at control point k, so
    // the radii below line up with the spine points they belong to.
    curve.getPoint(u, P);
    curve.getTangent(u, T);
    const f = u * (rings.length - 1), k = Math.min(rings.length - 2, Math.floor(f)), t = f - k;
    const rx = THREE.MathUtils.lerp(rings[k].rx, rings[k + 1].rx, t);
    const ry = THREE.MathUtils.lerp(rings[k].ry, rings[k + 1].ry, t);
    if (i === 0) {
      const ref = Math.abs(T.dot(up)) > 0.95 ? new THREE.Vector3(0, 0, 1) : up;
      S.crossVectors(ref, T).normalize();
    } else {
      // Parallel transport: carry the previous side vector along the spine
      // (re-deriving it from a fixed up flipped the frame on near-vertical
      // legs and twisted the tube at the hock).
      S.addScaledVector(T, -S.dot(T)).normalize();
    }
    N.crossVectors(T, S).normalize();
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      verts.push(
        P.x + S.x * Math.cos(a) * rx + N.x * Math.sin(a) * ry,
        P.y + S.y * Math.cos(a) * rx + N.y * Math.sin(a) * ry,
        P.z + S.z * Math.cos(a) * rx + N.z * Math.sin(a) * ry,
      );
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c); // outward-facing ((S,N,T) is right-handed)
  }
  // Caps (fan to the end centres).
  const capStart = verts.length / 3; const p0 = curve.getPoint(0); verts.push(p0.x, p0.y, p0.z);
  const capEnd = capStart + 1; const p1 = curve.getPoint(1); verts.push(p1.x, p1.y, p1.z);
  for (let j = 0; j < seg; j++) {
    idx.push(capStart, (j + 1) % seg, j);
    const last = (n - 1) * seg;
    idx.push(capEnd, last + j, last + ((j + 1) % seg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((verts.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

function buildDeer(): THREE.BufferGeometry {
  const coat = new THREE.Color('#8b5530');
  const back = new THREE.Color('#5f3a20');
  const belly = new THREE.Color('#e3d3b6');
  const legDark = new THREE.Color('#4a3322');
  const hoof = new THREE.Color('#1c1612');
  // Coat: darker along the back, pale underneath (by height within the torso).
  const torsoShade = (y: number, _x: number, z: number, c: THREE.Color) => {
    c.copy(coat);
    c.lerp(back, THREE.MathUtils.smoothstep(y, 1.24, 1.38) * 0.4);
    c.lerp(belly, (1 - THREE.MathUtils.smoothstep(y, 0.93, 1.05)) * 0.85);
    c.lerp(belly, THREE.MathUtils.smoothstep(-z, 0.52, 0.66) * 0.8); // pale rump
  };
  const neckShade = (_y: number, _x: number, z: number, c: THREE.Color) => {
    c.copy(coat);
    c.lerp(new THREE.Color('#3a2618'), THREE.MathUtils.smoothstep(z, 0.98, 1.06)); // dark muzzle tip
  };
  const legShade = (y: number, _x: number, _z: number, c: THREE.Color) => {
    c.copy(coat);
    c.lerp(legDark, (1 - THREE.MathUtils.smoothstep(y, 0.35, 0.7)) * 0.8);
    c.lerp(hoof, 1 - THREE.MathUtils.smoothstep(y, 0.03, 0.09));
  };

  const torso = loft([
    { p: [0, 1.14, -0.66], rx: 0.07, ry: 0.07 },
    { p: [0, 1.14, -0.55], rx: 0.2, ry: 0.22 },
    { p: [0, 1.12, -0.3], rx: 0.23, ry: 0.25 },
    { p: [0, 1.1, 0.0], rx: 0.2, ry: 0.22 },
    { p: [0, 1.12, 0.28], rx: 0.21, ry: 0.27 },
    { p: [0, 1.17, 0.46], rx: 0.14, ry: 0.19 },
  ], 14, 4);

  // Neck and head: one loft rising from inside the chest, so the head can
  // pivot at the chest (grazing) without tearing away from the body.
  const neckHead = loft([
    { p: [0, 1.12, 0.3], rx: 0.13, ry: 0.16 },
    { p: [0, 1.3, 0.5], rx: 0.1, ry: 0.13 },
    { p: [0, 1.52, 0.62], rx: 0.075, ry: 0.09 },
    { p: [0, 1.7, 0.72], rx: 0.085, ry: 0.095 },
    { p: [0, 1.72, 0.84], rx: 0.08, ry: 0.085 },
    { p: [0, 1.66, 0.97], rx: 0.05, ry: 0.055 },
    { p: [0, 1.63, 1.04], rx: 0.035, ry: 0.035 },
  ], 12, 4);

  const legRings = (x: number, pts: Array<[number, number, number]>): LoftRing[] =>
    pts.map(([y, z, r]) => ({ p: [x, y, z], rx: r, ry: r * 1.15 }));
  // Front leg: straight column, slim cannon bone. Hind leg: thigh, then the
  // backward hock that gives a deer its silhouette.
  const frontLeg = (x: number) => loft(legRings(x, [
    [1.15, 0.28, 0.085], [0.9, 0.32, 0.06], [0.55, 0.35, 0.03], [0.3, 0.35, 0.024], [0.1, 0.37, 0.022], [0.0, 0.39, 0.03],
  ]), 7, 3);
  const hindLeg = (x: number) => loft(legRings(x, [
    [1.2, -0.36, 0.12], [0.92, -0.3, 0.085], [0.58, -0.44, 0.036], [0.26, -0.43, 0.024], [0.1, -0.42, 0.022], [0.0, -0.4, 0.03],
  ]), 7, 3);

  const HEAD_PIVOT: [number, number, number] = [0, 1.18, 0.4];
  const ear = (side: number) => {
    const g = ellipsoid(0.045, 0.1, 0.018, 0, 0, 0, 8);
    g.rotateZ(side * -0.7).rotateY(side * 0.3).translate(side * 0.09, 1.82, 0.74);
    return g;
  };
  const parts = [
    tag(torso, PART_BODY, [0, 0, 0], coat, torsoShade),
    tag(neckHead, PART_HEAD, HEAD_PIVOT, coat, neckShade),
    tag(ear(1), PART_HEAD, HEAD_PIVOT, '#6e4527'),
    tag(ear(-1), PART_HEAD, HEAD_PIVOT, '#6e4527'),
    tag(ellipsoid(0.018, 0.02, 0.018, 0.065, 1.74, 0.87, 6), PART_HEAD, HEAD_PIVOT, '#0b0806'),
    tag(ellipsoid(0.018, 0.02, 0.018, -0.065, 1.74, 0.87, 6), PART_HEAD, HEAD_PIVOT, '#0b0806'),
    tag(ellipsoid(0.028, 0.022, 0.02, 0, 1.64, 1.055, 6), PART_HEAD, HEAD_PIVOT, '#0e0b09'),
    tag(ellipsoid(0.055, 0.09, 0.03, 0, 1.2, -0.67, 8), PART_TAIL, [0, 1.24, -0.64], '#f1e8d8'),
    tag(frontLeg(0.1), PART_LEG_FL, [0.1, 1.1, 0.3], coat, legShade),
    tag(frontLeg(-0.1), PART_LEG_FR, [-0.1, 1.1, 0.3], coat, legShade),
    tag(hindLeg(0.1), PART_LEG_BL, [0.1, 1.16, -0.38], coat, legShade),
    tag(hindLeg(-0.1), PART_LEG_BR, [-0.1, 1.16, -0.38], coat, legShade),
  ];
  return BufferGeometryUtils.mergeGeometries(parts)!;
}

function buildBird(): THREE.BufferGeometry {
  const body = (y: number, _x: number, _z: number, c: THREE.Color) => c.lerp(new THREE.Color('#c9b79a'), THREE.MathUtils.smoothstep(0.0, -0.05, y) * 0.8);
  const wing = (span: number, mirror: boolean) => {
    // Tapered wing: a flat quad strip from root to tip. The mirrored wing
    // reverses its triangle order so both face up (scaling by -1 flipped the
    // winding and the right wing rendered black from above).
    const g = new THREE.BufferGeometry();
    const m = mirror ? -1 : 1;
    const A = [0, 0, 0.09], B = [m * span, 0, 0.02], C = [m * span, 0, -0.06], D = [0, 0, -0.1];
    const tris = mirror ? [A, C, B, A, D, C] : [A, B, C, A, C, D];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 2));
    g.computeVertexNormals();
    return g;
  };
  const left = wing(0.34, false); left.translate(0.04, 0.02, 0);
  const right = wing(0.34, true); right.translate(-0.04, 0.02, 0);
  const parts = [
    tag(ellipsoid(0.055, 0.05, 0.15, 0, 0, 0, 8), PART_BODY, [0, 0, 0], '#4a3b2c', body),
    tag(ellipsoid(0.04, 0.04, 0.045, 0, 0.03, 0.13, 8), PART_BODY, [0, 0, 0], '#3a2e24'),
    tag(new THREE.ConeGeometry(0.012, 0.04, 5).rotateX(Math.PI / 2).translate(0, 0.025, 0.19), PART_BODY, [0, 0, 0], '#d9a441'),
    tag(new THREE.BoxGeometry(0.1, 0.008, 0.1).translate(0, 0, -0.19), PART_TAIL, [0, 0, -0.14], '#3a2e24'),
    tag(left, PART_WING_L, [0.04, 0.02, 0], '#51402f'),
    tag(right, PART_WING_R, [-0.04, 0.02, 0], '#51402f'),
  ];
  return BufferGeometryUtils.mergeGeometries(parts)!;
}

function buildFish(): THREE.BufferGeometry {
  const scales = (y: number, _x: number, _z: number, c: THREE.Color) => {
    c.lerp(new THREE.Color('#dfe6e8'), 1 - THREE.MathUtils.smoothstep(y, -0.04, 0.02)); // pale belly only
  };
  const tail = new THREE.ConeGeometry(0.07, 0.12, 4).rotateX(-Math.PI / 2).scale(0.25, 1, 1).translate(0, 0, -0.24);
  const parts = [
    tag(ellipsoid(0.035, 0.06, 0.2, 0, 0, 0, 10), PART_BODY, [0, 0, 0], '#4d6a6e', scales),
    tag(tail, PART_TAIL, [0, 0, -0.18], '#3f5a5e'),
    tag(ellipsoid(0.012, 0.012, 0.012, 0.03, 0.02, 0.13, 5), PART_BODY, [0, 0, 0], '#111111'),
    tag(ellipsoid(0.012, 0.012, 0.012, -0.03, 0.02, 0.13, 5), PART_BODY, [0, 0, 0], '#111111'),
  ];
  return BufferGeometryUtils.mergeGeometries(parts)!;
}

function buildRootling(): THREE.BufferGeometry {
  // A small wood spirit: a knotted trunk-body flaring into root legs, a round
  // head, Lumina eyes, a two-leaf sprout and twig arms. Every limb is lofted
  // from a joint buried inside the body and pivots at that joint, so swinging
  // never pulls it away from the body.
  const bark = (y: number, x: number, z: number, c: THREE.Color) => {
    const n = Math.sin(y * 38 + x * 11) * 0.5 + Math.sin(z * 29 + y * 7) * 0.5;
    c.multiplyScalar(0.82 + 0.18 * n);
    c.lerp(new THREE.Color('#3f5a2a'), THREE.MathUtils.smoothstep(y, 0.6, 0.68) * 0.25); // moss at the collar
  };
  const body = loft([
    { p: [0, 0.2, 0], rx: 0.12, ry: 0.11 },
    { p: [0.005, 0.32, 0], rx: 0.16, ry: 0.145 },
    { p: [0, 0.48, 0.01], rx: 0.15, ry: 0.14 },
    { p: [-0.005, 0.64, 0.02], rx: 0.1, ry: 0.1 },
  ], 14, 4);
  const HIP: [number, number, number] = [0.065, 0.3, 0];
  const SHOULDER: [number, number, number] = [0.09, 0.5, 0.01];
  // Root leg: from the hip inside the body down to a foot that splays forward.
  const leg = (side: number) => loft([
    { p: [side * HIP[0], HIP[1], HIP[2]], rx: 0.06, ry: 0.06 },
    { p: [side * 0.08, 0.16, 0.0], rx: 0.05, ry: 0.05 },
    { p: [side * 0.088, 0.045, 0.03], rx: 0.042, ry: 0.038 },
    { p: [side * 0.095, 0.02, 0.1], rx: 0.036, ry: 0.022 },
  ], 8, 3);
  // Twig arm: from the shoulder inside the body, out and down, ending in two little twigs.
  const arm = (side: number) => BufferGeometryUtils.mergeGeometries([
    loft([
      { p: [side * SHOULDER[0], SHOULDER[1], SHOULDER[2]], rx: 0.034, ry: 0.034 },
      { p: [side * 0.17, 0.47, 0.02], rx: 0.024, ry: 0.024 },
      { p: [side * 0.225, 0.37, 0.04], rx: 0.018, ry: 0.018 },
      { p: [side * 0.24, 0.29, 0.06], rx: 0.013, ry: 0.013 },
    ], 6, 3),
    loft([
      { p: [side * 0.235, 0.31, 0.055], rx: 0.009, ry: 0.009 },
      { p: [side * 0.275, 0.27, 0.08], rx: 0.005, ry: 0.005 },
    ], 5, 2),
  ])!;
  const leaf = (side: number) => {
    const g = ellipsoid(0.1, 0.014, 0.05, 0, 0, 0, 8);
    g.translate(0.09, 0, 0).rotateZ(side > 0 ? 0.5 : Math.PI - 0.5).translate(0, 0.96, 0);
    return g;
  };
  const parts = [
    tag(body, PART_BODY, [0, 0, 0], '#6b4a2e', bark),
    tag(ellipsoid(0.15, 0.14, 0.14, 0, 0.72, 0.02, 14), PART_HEAD, [0, 0.62, 0], '#7a5634', bark),
    // Glowing Lumina eyes.
    tag(ellipsoid(0.032, 0.042, 0.02, 0.055, 0.74, 0.14, 8), PART_GLOW, [0, 0.62, 0], '#8ff7ff'),
    tag(ellipsoid(0.032, 0.042, 0.02, -0.055, 0.74, 0.14, 8), PART_GLOW, [0, 0.62, 0], '#8ff7ff'),
    // Sprout: stem and two leaves.
    tag(limb(0.012, 0.016, 0.13, 0, 0.97, 0, 5), PART_SPROUT, [0, 0.84, 0], '#4e7a2a'),
    tag(leaf(1), PART_SPROUT, [0, 0.84, 0], '#6cbc44'),
    tag(leaf(-1), PART_SPROUT, [0, 0.84, 0], '#5da83a'),
    // Root legs and twig arms (arm parts reuse the wing channels for swing).
    tag(leg(1), PART_LEG_FL, [HIP[0], HIP[1], HIP[2]], '#5a3d25', bark),
    tag(leg(-1), PART_LEG_FR, [-HIP[0], HIP[1], HIP[2]], '#5a3d25', bark),
    tag(arm(1), PART_WING_L, [SHOULDER[0], SHOULDER[1], SHOULDER[2]], '#5a3d25'),
    tag(arm(-1), PART_WING_R, [-SHOULDER[0], SHOULDER[1], SHOULDER[2]], '#5a3d25'),
  ];
  return BufferGeometryUtils.mergeGeometries(parts)!;
}

const geometryCache = new Map<CreatureKind, THREE.BufferGeometry>();
export function getCreatureGeometry(kind: CreatureKind): THREE.BufferGeometry {
  let g = geometryCache.get(kind);
  if (!g) {
    g = kind === 'deer' ? buildDeer() : kind === 'bird' ? buildBird() : kind === 'fish' ? buildFish() : buildRootling();
    g.computeBoundingSphere();
    geometryCache.set(kind, g);
  }
  return g;
}

const KIND_ID: Record<CreatureKind, number> = { bird: 0, deer: 1, fish: 2, rootling: 3 };

/** One material per kind (the rig logic branches on a constant uniform). */
export function createCreatureMaterial(kind: CreatureKind): THREE.Material {
  return new (CustomShaderMaterial as unknown as new (o: object) => THREE.Material)({
    baseMaterial: THREE.MeshStandardMaterial,
    vertexColors: true,
    roughness: kind === 'fish' ? 0.35 : 0.85,
    metalness: kind === 'fish' ? 0.25 : 0.0,
    side: kind === 'bird' ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: { uKind: { value: KIND_ID[kind] }, uTime: sharedUniforms.uTime },
    vertexShader: /* glsl */ `
      attribute float aPart;
      attribute vec3 aPivot;
      attribute vec4 aAnim;
      uniform float uKind;
      uniform float uTime;
      varying float vGlow;

      // Rotate p around the X (pitch) or Z (roll) axis through a pivot.
      vec3 rotX(vec3 p, vec3 pivot, float a) {
        vec3 q = p - pivot; float c = cos(a), s = sin(a);
        return pivot + vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
      }
      vec3 rotZ(vec3 p, vec3 pivot, float a) {
        vec3 q = p - pivot; float c = cos(a), s = sin(a);
        return pivot + vec3(q.x * c - q.y * s, q.x * s + q.y * c, q.z);
      }

      void main() {
        vec3 p = position;
        vec3 n = normal;
        float phase = aAnim.x, amp = aAnim.y, headDown = aAnim.z;
        vGlow = aPart > 8.5 && aPart < 9.5 ? aAnim.w : 0.0;

        if (uKind < 0.5) {
          // Bird: wings flap about the body axis, more at the tips.
          float flap = sin(phase) * amp;
          if (aPart > 0.5 && aPart < 1.5) { float t = clamp(abs(p.x - aPivot.x) / 0.34, 0.0, 1.0); p = rotZ(p, aPivot, flap * (0.8 + 0.5 * t)); }
          if (aPart > 1.5 && aPart < 2.5) { float t = clamp(abs(p.x - aPivot.x) / 0.34, 0.0, 1.0); p = rotZ(p, aPivot, -flap * (0.8 + 0.5 * t)); }
          p.y += sin(phase + 1.6) * amp * 0.02;
        } else if (uKind < 1.5) {
          // Deer: diagonal-pair gait, head lowers to graze, tail flicks.
          float swing = amp * 0.55;
          if (aPart > 2.5 && aPart < 3.5) p = rotX(p, aPivot, sin(phase) * swing);
          if (aPart > 3.5 && aPart < 4.5) p = rotX(p, aPivot, sin(phase + 3.14159) * swing);
          if (aPart > 4.5 && aPart < 5.5) p = rotX(p, aPivot, sin(phase + 3.14159) * swing);
          if (aPart > 5.5 && aPart < 6.5) p = rotX(p, aPivot, sin(phase) * swing);
          if (aPart > 6.5 && aPart < 7.5) {
            float graze = headDown * 1.15 + sin(uTime * 3.0 + phase) * 0.03 * headDown;
            p = rotX(p, aPivot, graze - abs(sin(phase)) * amp * 0.08);
          }
          if (aPart > 7.5 && aPart < 8.5) p = rotX(p, aPivot, sin(uTime * 7.0 + phase) * 0.25);
          p.y += abs(sin(phase)) * amp * 0.05; // body bob
        } else if (uKind < 2.5) {
          // Fish: travelling body wave, tail swings most.
          float along = clamp((0.2 - p.z) / 0.45, 0.0, 1.0);
          p.x += sin(phase - p.z * 9.0) * amp * 0.06 * along * along;
        } else {
          // Rootling: waddle and swing while walking; when running (head
          // channel = run 0..1) it leans in and bounds, arms trailing.
          float run = headDown;
          float legSwing = amp * mix(0.6, 0.45, run);
          if (aPart > 2.5 && aPart < 3.5) p = rotX(p, aPivot, sin(phase) * legSwing);
          if (aPart > 3.5 && aPart < 4.5) p = rotX(p, aPivot, -sin(phase) * legSwing);
          float armSwing = amp * mix(0.5, 0.25, run);
          if (aPart > 0.5 && aPart < 1.5) p = rotX(p, aPivot, -sin(phase) * armSwing + run * 0.7);
          if (aPart > 1.5 && aPart < 2.5) p = rotX(p, aPivot, sin(phase) * armSwing + run * 0.7);
          if (aPart > 9.5) p = rotZ(p, aPivot, sin(uTime * 4.0 + phase) * 0.15);
          if (aPart > 9.5) p = rotX(p, aPivot, -run * 0.5);
          p = rotZ(p, vec3(0.0), sin(phase) * amp * 0.08 * (1.0 - run));
          p = rotX(p, vec3(0.0, 0.1, 0.0), run * 0.32);
          p.y += abs(sin(phase)) * amp * mix(0.05, 0.3, run);
        }
        csm_Position = p;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        csm_Emissive = vec3(0.55, 0.97, 1.0) * vGlow * 2.5;
      }
    `,
  });
}
