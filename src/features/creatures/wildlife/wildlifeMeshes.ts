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

function buildDeer(): THREE.BufferGeometry {
  const fur = '#9a6236';
  const shade = (y: number, _x: number, z: number, c: THREE.Color) => {
    // Pale belly/throat, dark dorsal stripe, rump patch.
    c.lerp(new THREE.Color('#ecdfc6'), THREE.MathUtils.smoothstep(1.02, 0.84, y) * 0.85);
    c.lerp(new THREE.Color('#5e3a20'), THREE.MathUtils.smoothstep(1.22, 1.34, y) * 0.6);
    c.lerp(new THREE.Color('#efe6d6'), THREE.MathUtils.smoothstep(-0.5, -0.64, z) * 0.7);
  };
  const legC = (y: number, _x: number, _z: number, c: THREE.Color) => {
    c.lerp(new THREE.Color('#3a2616'), THREE.MathUtils.smoothstep(0.25, 0.05, y)); // dark hooves
  };
  const hipY = 1.0, shoulderY = 1.02;
  const neck = limb(0.085, 0.13, 0.62, 0, 1.62, 0.0).rotateX(0.5).translate(0, 0.02, 0.5);
  const leg = (part: number, x: number, z: number, top: number, thick: number) => [
    // Upper leg (thigh / shoulder muscle) and a slim lower leg with a hoof.
    tag(ellipsoid(0.075 * thick, 0.24, 0.12 * thick, x, top - 0.12, z), part, [x, top, z], fur, shade),
    tag(limb(0.05 * thick, 0.035, 0.5, x, top - 0.3, z + (z > 0 ? 0.0 : -0.03)), part, [x, top, z], fur, legC),
    tag(limb(0.034, 0.028, 0.34, x, top - 0.68, z + (z > 0 ? 0.02 : -0.05)), part, [x, top, z], fur, legC),
  ];
  const parts = [
    tag(ellipsoid(0.24, 0.26, 0.58, 0, 1.1, -0.02, 14), PART_BODY, [0, 0, 0], fur, shade),
    tag(ellipsoid(0.23, 0.28, 0.24, 0, 1.08, 0.3, 12), PART_BODY, [0, 0, 0], fur, shade),   // chest
    tag(ellipsoid(0.22, 0.25, 0.22, 0, 1.12, -0.38, 12), PART_BODY, [0, 0, 0], fur, shade), // haunches
    tag(ellipsoid(0.07, 0.11, 0.05, 0, 1.2, -0.62), PART_TAIL, [0, 1.25, -0.58], '#f4ede0'),
    tag(neck, PART_HEAD, [0, 1.15, 0.42], fur, shade),
    tag(ellipsoid(0.1, 0.11, 0.2, 0, 1.64, 0.83), PART_HEAD, [0, 1.15, 0.42], fur, shade),
    tag(ellipsoid(0.06, 0.06, 0.1, 0, 1.6, 0.99), PART_HEAD, [0, 1.15, 0.42], '#4a2f1c'),   // muzzle
    tag(ellipsoid(0.028, 0.028, 0.028, 0, 1.6, 1.08), PART_HEAD, [0, 1.15, 0.42], '#111111'),
    tag(ellipsoid(0.02, 0.02, 0.02, 0.075, 1.69, 0.9), PART_HEAD, [0, 1.15, 0.42], '#0b0b0b'),
    tag(ellipsoid(0.02, 0.02, 0.02, -0.075, 1.69, 0.9), PART_HEAD, [0, 1.15, 0.42], '#0b0b0b'),
    tag(ellipsoid(0.04, 0.11, 0.025, 0.1, 1.8, 0.76).rotateZ(-0.35), PART_HEAD, [0, 1.15, 0.42], '#7a4e2c'),
    tag(ellipsoid(0.04, 0.11, 0.025, -0.1, 1.8, 0.76).rotateZ(0.35), PART_HEAD, [0, 1.15, 0.42], '#7a4e2c'),
    ...leg(PART_LEG_FL, 0.13, 0.36, shoulderY, 1),
    ...leg(PART_LEG_FR, -0.13, 0.36, shoulderY, 1),
    ...leg(PART_LEG_BL, 0.14, -0.38, hipY, 1.25),
    ...leg(PART_LEG_BR, -0.14, -0.38, hipY, 1.25),
  ];
  return BufferGeometryUtils.mergeGeometries(parts)!;
}

function buildBird(): THREE.BufferGeometry {
  const body = (y: number, _x: number, _z: number, c: THREE.Color) => c.lerp(new THREE.Color('#c9b79a'), THREE.MathUtils.smoothstep(0.0, -0.05, y) * 0.8);
  const wing = (span: number) => {
    // Tapered wing: a flat quad strip from root to tip.
    const g = new THREE.BufferGeometry();
    const w = [0, 0, 0.09, span, 0, 0.02, span, 0, -0.06, 0, 0, -0.1];
    const verts = new Float32Array([...w.slice(0, 3), ...w.slice(3, 6), ...w.slice(6, 9), ...w.slice(0, 3), ...w.slice(6, 9), ...w.slice(9, 12)]);
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(12), 2));
    g.computeVertexNormals();
    return g;
  };
  const left = wing(0.34); left.translate(0.04, 0.02, 0);
  const right = wing(0.34); right.scale(-1, 1, 1); right.translate(-0.04, 0.02, 0);
  // Mirroring flips the winding: flip normals back up.
  const rn = right.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < rn.count; i++) rn.setY(i, Math.abs(rn.getY(i)));
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
    c.lerp(new THREE.Color('#dfe6e8'), THREE.MathUtils.smoothstep(0.02, -0.04, y));
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
  const bark = (y: number, x: number, z: number, c: THREE.Color) => {
    const n = Math.sin(y * 40 + x * 13) * 0.5 + Math.sin(z * 31) * 0.5;
    c.multiplyScalar(0.85 + 0.15 * n);
  };
  const parts = [
    tag(ellipsoid(0.2, 0.24, 0.18, 0, 0.42, 0, 12), PART_BODY, [0, 0, 0], '#6b4a2e', bark),
    tag(ellipsoid(0.16, 0.14, 0.15, 0, 0.72, 0.02, 12), PART_HEAD, [0, 0.62, 0], '#7a5634', bark),
    // Glowing Lumina eyes.
    tag(ellipsoid(0.035, 0.045, 0.02, 0.06, 0.75, 0.15, 6), PART_GLOW, [0, 0.62, 0], '#8ff7ff'),
    tag(ellipsoid(0.035, 0.045, 0.02, -0.06, 0.75, 0.15, 6), PART_GLOW, [0, 0.62, 0], '#8ff7ff'),
    // Leaf sprout on the head.
    tag(ellipsoid(0.1, 0.012, 0.05, 0.07, 0.9, 0, 6).rotateZ(-0.5), PART_SPROUT, [0, 0.84, 0], '#5da83a'),
    tag(ellipsoid(0.1, 0.012, 0.05, -0.07, 0.9, 0, 6).rotateZ(0.5), PART_SPROUT, [0, 0.84, 0], '#6cbc44'),
    tag(limb(0.02, 0.015, 0.14, 0, 0.94, 0, 4), PART_SPROUT, [0, 0.84, 0], '#4e7a2a'),
    // Stubby root legs and twig arms.
    tag(limb(0.06, 0.08, 0.22, 0.09, 0.22, 0), PART_LEG_FL, [0.09, 0.22, 0], '#5a3d25'),
    tag(limb(0.06, 0.08, 0.22, -0.09, 0.22, 0), PART_LEG_FR, [-0.09, 0.22, 0], '#5a3d25'),
    tag(limb(0.025, 0.015, 0.22, 0.2, 0.52, 0).rotateZ(0.6), PART_WING_L, [0.18, 0.5, 0], '#5a3d25'),
    tag(limb(0.025, 0.015, 0.22, -0.2, 0.52, 0).rotateZ(-0.6), PART_WING_R, [-0.18, 0.5, 0], '#5a3d25'),
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
          // Rootling: waddle, arm swing, sprout bounce.
          if (aPart > 2.5 && aPart < 3.5) p = rotX(p, aPivot, sin(phase) * amp * 0.6);
          if (aPart > 3.5 && aPart < 4.5) p = rotX(p, aPivot, -sin(phase) * amp * 0.6);
          if (aPart > 0.5 && aPart < 1.5) p = rotX(p, aPivot, -sin(phase) * amp * 0.5);
          if (aPart > 1.5 && aPart < 2.5) p = rotX(p, aPivot, sin(phase) * amp * 0.5);
          if (aPart > 9.5) p = rotZ(p, aPivot, sin(uTime * 4.0 + phase) * 0.15);
          p = rotZ(p, vec3(0.0), sin(phase) * amp * 0.08);
          p.y += abs(sin(phase)) * amp * 0.05;
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
