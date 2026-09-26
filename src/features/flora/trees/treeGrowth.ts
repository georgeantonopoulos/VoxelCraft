import * as THREE from 'three';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

/**
 * Procedural tree growth: skeleton -> tapered bark tubes + leaf cards.
 *
 * Pure (no GPU objects), deterministic per (type, variant, lod), so it can be
 * cached, unit tested and moved to a worker later. TreeGeometryFactory turns the
 * result into BufferGeometries for TreeLayer / FallingTree.
 *
 * Wood attributes (consumed by the tree shaders):
 *   aBranchDepth  0 trunk .. 1 finest twigs (wind sway weight)
 *   aBranchAxis   segment direction, aBranchOrigin segment start (bark mapping)
 * Leaf attributes: uv (leaf atlas), aLeafRand (per-card random).
 * Collision: unit-cylinder transforms (radius 0.25 * scale.x, height scale.y,
 * base at position, growing along the rotated +Y), trunk and main limbs only.
 */

export interface TreeMeshData {
  wood: {
    positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array;
    depth: Float32Array; axis: Float32Array; origin: Float32Array;
  };
  leaves: {
    positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array;
    rand: Float32Array;
  };
  collision: Array<{ position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>;
  /** Approximate height of the tree (m). */
  height: number;
}

type Lod = 'high' | 'low';

interface Species {
  trunkLength: [number, number];
  trunkRadius: number;
  /** Radius at the tip of a branch relative to its base. */
  taper: number;
  /** Node spacing along branches (m). */
  step: number;
  /** Max recursion depth (trunk = 0). */
  depth: number;
  /** Children per branch and where along the parent they start (fraction). */
  children: [number, number];
  childStart: number;
  /** Child angle from parent (radians) and its randomness. */
  angle: number;
  angleJitter: number;
  /** Child length relative to parent length. */
  lengthRatio: number;
  /** Child radius relative to the parent radius at the fork. */
  radiusRatio: number;
  /** Upward pull per metre (+ up, - droop). */
  gravitropism: number;
  /** Directional noise per metre. */
  wobble: number;
  /** Whorled branching (pines): children evenly around the node. */
  whorl?: boolean;
  /** Crown shape for leaf normals: centre height fraction and flattening. */
  crownCenter: number;
  crownFlatten: number;
  /** Leaf cards. */
  leafSize: [number, number];
  leafDensity: number; // cards per metre of twig
  leafFlat?: number;   // 0..1 how horizontal the cards lie (acacia)
  leafAlong?: boolean; // elongated cards aligned with the twig (pine sprays)
  /** Root flare / buttresses at the trunk base. */
  buttress: number;
}

const DEG = Math.PI / 180;

const SPECIES: Record<number, Species> = {
  [TreeType.OAK]: {
    trunkLength: [3.2, 4.2], trunkRadius: 0.36, taper: 0.22, step: 0.55, depth: 4,
    children: [2, 4], childStart: 0.35, angle: 42 * DEG, angleJitter: 14 * DEG,
    lengthRatio: 0.72, radiusRatio: 0.62, gravitropism: 0.18, wobble: 0.35,
    crownCenter: 0.72, crownFlatten: 0.85, leafSize: [1.1, 1.5], leafDensity: 6, buttress: 0.35,
  },
  [TreeType.PINE]: {
    trunkLength: [10, 13], trunkRadius: 0.32, taper: 0.08, step: 0.6, depth: 2,
    children: [4, 5], childStart: 0.18, angle: 82 * DEG, angleJitter: 8 * DEG,
    lengthRatio: 0.32, radiusRatio: 0.28, gravitropism: -0.06, wobble: 0.12, whorl: true,
    crownCenter: 0.55, crownFlatten: 1.6, leafSize: [0.9, 1.3], leafDensity: 4, leafAlong: true, buttress: 0.2,
  },
  [TreeType.PALM]: {
    trunkLength: [6.5, 8.5], trunkRadius: 0.22, taper: 0.75, step: 0.5, depth: 1,
    children: [0, 0], childStart: 1, angle: 0, angleJitter: 0,
    lengthRatio: 0, radiusRatio: 0, gravitropism: 0.1, wobble: 0.08,
    crownCenter: 0.95, crownFlatten: 0.6, leafSize: [3.4, 3.8], leafDensity: 0, buttress: 0.25,
  },
  [TreeType.JUNGLE]: {
    trunkLength: [11, 15], trunkRadius: 0.6, taper: 0.3, step: 0.7, depth: 4,
    children: [2, 3], childStart: 0.62, angle: 55 * DEG, angleJitter: 15 * DEG,
    lengthRatio: 0.5, radiusRatio: 0.55, gravitropism: 0.08, wobble: 0.25,
    crownCenter: 0.88, crownFlatten: 0.55, leafSize: [2.0, 2.4], leafDensity: 12, buttress: 1.0,
  },
  [TreeType.ACACIA]: {
    trunkLength: [2.2, 3.0], trunkRadius: 0.26, taper: 0.25, step: 0.5, depth: 4,
    children: [2, 3], childStart: 0.7, angle: 38 * DEG, angleJitter: 12 * DEG,
    lengthRatio: 0.85, radiusRatio: 0.66, gravitropism: 0.05, wobble: 0.3,
    crownCenter: 0.92, crownFlatten: 0.3, leafSize: [1.4, 1.6], leafDensity: 12, leafFlat: 0.85, buttress: 0.2,
  },
  [TreeType.CACTUS]: {
    trunkLength: [3.0, 4.2], trunkRadius: 0.32, taper: 0.8, step: 0.35, depth: 1,
    children: [1, 3], childStart: 0.3, angle: 80 * DEG, angleJitter: 10 * DEG,
    lengthRatio: 0.45, radiusRatio: 0.72, gravitropism: 2.2, wobble: 0.02,
    crownCenter: 0.5, crownFlatten: 1, leafSize: [0, 0], leafDensity: 0, buttress: 0,
  },
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Node { p: THREE.Vector3; r: number; }
interface Branch { nodes: Node[]; depth: number; length: number; root?: boolean; }

/** Growable arrays for mesh building. */
class Buf {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; idx: number[] = [];
  extra: number[][];
  constructor(extraCount: number) { this.extra = Array.from({ length: extraCount }, () => []); }
  get vertexCount() { return this.pos.length / 3; }
}

export function growTree(type: TreeType, variant = 0, lod: Lod = 'high'): TreeMeshData {
  const sp = SPECIES[type] ?? SPECIES[TreeType.OAK];
  const rand = mulberry32(0x7a3e + type * 7919 + variant * 104729);
  const rr = (a: number, b: number) => a + (b - a) * rand();
  const branches: Branch[] = [];
  const low = lod === 'low';

  // --- Skeleton ---------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const growBranch = (start: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) => {
    const steps = Math.max(2, Math.round(length / (sp.step * (1 + depth * 0.6))));
    const segLen = length / steps;
    const d = dir.clone().normalize();
    const nodes: Node[] = [{ p: start.clone(), r: radius }];
    const p = start.clone();
    // Palms lean and curve; cacti bend sharply upward after leaving the trunk.
    const lean = type === TreeType.PALM ? new THREE.Vector3(rr(-1, 1), 0, rr(-1, 1)).normalize().multiplyScalar(0.07) : null;
    for (let i = 1; i <= steps; i++) {
      tmp.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(sp.wobble * segLen * 2);
      d.add(tmp);
      d.addScaledVector(up, sp.gravitropism * segLen * (depth === 0 ? 0.3 : 1));
      if (lean && i < steps * 0.8) d.add(lean);
      d.normalize();
      p.addScaledVector(d, segLen);
      const t = i / steps;
      nodes.push({ p: p.clone(), r: Math.max(radius * (1 - (1 - sp.taper) * t), 0.012) });
    }
    const br: Branch = { nodes, depth, length };
    branches.push(br);
    return br;
  };

  const trunkLen = rr(sp.trunkLength[0], sp.trunkLength[1]);
  const trunkDir = new THREE.Vector3(rr(-0.06, 0.06), 1, rr(-0.06, 0.06));
  const trunk = growBranch(new THREE.Vector3(0, -0.4, 0), trunkDir, trunkLen + 0.4, sp.trunkRadius, 0);

  const spawnChildren = (parent: Branch) => {
    if (parent.depth >= sp.depth - (low ? 1 : 0) || sp.children[1] === 0) return;
    const nodes = parent.nodes;
    const first = Math.max(1, Math.floor(nodes.length * sp.childStart));
    const count = sp.whorl && parent.depth > 0 ? Math.round(rr(1, 3)) : Math.round(rr(sp.children[0], sp.children[1]));
    // Pines: whorls on many nodes; others: children spread over the upper part.
    const forkNodes: number[] = [];
    const whorl = !!sp.whorl && parent.depth === 0;
    if (whorl) {
      for (let i = first; i < nodes.length - 1; i += 2) forkNodes.push(i);
    } else {
      for (let c = 0; c < count; c++) forkNodes.push(Math.min(nodes.length - 1, first + Math.floor(rand() * (nodes.length - first))));
      // The branch tip always continues (apical growth) for deciduous crowns.
      if (!forkNodes.includes(nodes.length - 1) && type !== TreeType.CACTUS) forkNodes.push(nodes.length - 1);
    }
    let azimuth = rand() * Math.PI * 2;
    for (const ni of forkNodes) {
      const node = nodes[ni];
      const prev = nodes[Math.max(0, ni - 1)].p;
      const parentDir = node.p.clone().sub(prev).normalize();
      const perWhorl = whorl ? Math.round(rr(sp.children[0], sp.children[1])) : 1;
      for (let w = 0; w < perWhorl; w++) {
        azimuth += whorl ? (Math.PI * 2) / perWhorl + rr(-0.3, 0.3) : 2.39996 + rr(-0.4, 0.4); // golden angle
        const angle = sp.angle + rr(-sp.angleJitter, sp.angleJitter);
        // Rotate parentDir by `angle` around a perpendicular axis chosen by azimuth.
        const ref = Math.abs(parentDir.y) < 0.95 ? up : new THREE.Vector3(1, 0, 0);
        const perp = ref.clone().cross(parentDir).normalize();
        perp.applyAxisAngle(parentDir, azimuth);
        const childDir = parentDir.clone().applyAxisAngle(perp, angle);
        const along = ni / (nodes.length - 1);
        // Upper children are shorter (conical pines) / lower ones longer.
        const remaining = parent.length * (1 - along * (whorl ? 1 : 0.35));
        let len = remaining * sp.lengthRatio * rr(0.8, 1.15);
        if (whorl) len = Math.max(0.6, parent.length * sp.lengthRatio * (1 - along) * rr(0.85, 1.1) + 0.4);
        else if (sp.whorl) len = Math.max(0.3, parent.length * 0.35 * rr(0.7, 1.1));
        if (type === TreeType.CACTUS) len = rr(0.9, 1.6);
        // Base a little narrower than the parent and starting just behind its
        // axis: at 0.6 radii back, the child's cut face reached past the far
        // side of the (low-poly) parent and showed as a flat plate.
        const r = Math.max(Math.min(node.r * sp.radiusRatio, node.r * 0.85), 0.015);
        const start = node.p.clone().addScaledVector(childDir, -node.r * 0.2);
        const child = growBranch(start, childDir, len, r, parent.depth + 1);
        spawnChildren(child);
      }
    }
  };
  spawnChildren(trunk);

  // Buttress / root flare: short roots leaving the trunk base and diving into the ground.
  if (sp.buttress > 0) {
    const roots = type === TreeType.JUNGLE ? 5 : 4;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2 + rand() * 0.5;
      const dir = new THREE.Vector3(Math.cos(a), -0.55, Math.sin(a));
      const start = new THREE.Vector3(0, 0.35 + sp.buttress * 0.9, 0);
      const len = 0.8 + sp.buttress * 1.8;
      const steps = 4;
      const nodes: Node[] = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = start.clone().addScaledVector(dir.clone().normalize(), len * t);
        p.y -= t * t * 0.4;
        nodes.push({ p, r: sp.trunkRadius * (0.55 + 0.3 * sp.buttress) * (1 - 0.8 * t) });
      }
      branches.push({ nodes, depth: 0, length: len, root: true });
    }
  }

  // --- Wood mesh -------------------------------------------------------------------
  const wood = new Buf(7); // depth(1) axis(3) origin(3)
  const collision: TreeMeshData['collision'] = [];
  const maxDepth = Math.max(1, sp.depth);
  const BARK_TILE = 1.2; // metres per bark UV repeat

  for (const br of branches) {
    const sides = br.depth === 0 ? (low ? 6 : 10) : br.depth === 1 ? (low ? 4 : 6) : br.depth === 2 ? (low ? 3 : 4) : 3;
    const nodes = br.nodes;
    const base = wood.vertexCount;
    // Parallel-transport frame.
    let dir = nodes[1].p.clone().sub(nodes[0].p).normalize();
    const ref = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    let nrmA = ref.clone().cross(dir).normalize();
    let along = 0;
    const depthN = Math.min(1, br.depth / maxDepth);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (i > 0) {
        const nd = (i < nodes.length - 1 ? nodes[i + 1].p.clone().sub(nodes[i - 1].p) : n.p.clone().sub(nodes[i - 1].p)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(dir, nd);
        nrmA.applyQuaternion(q);
        dir = nd;
        along += n.p.distanceTo(nodes[i - 1].p);
      }
      const nrmB = dir.clone().cross(nrmA).normalize();
      // Flare the trunk base; bark ridges give the silhouette some irregularity.
      let radius = n.r;
      if (br.depth === 0 && i <= 1 && br === trunk) radius *= 1 + sp.buttress * 0.35 + 0.25;
      const segStart = nodes[Math.max(0, i - 1)].p;
      const circ = Math.max(1, Math.round((Math.PI * 2 * radius) / BARK_TILE * 2));
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const ridge = br.depth === 0 && !low ? 1 + 0.06 * Math.sin(a * 7 + along * 1.3) : 1;
        const nx = nrmA.x * ca + nrmB.x * sa, ny = nrmA.y * ca + nrmB.y * sa, nz = nrmA.z * ca + nrmB.z * sa;
        wood.pos.push(n.p.x + nx * radius * ridge, n.p.y + ny * radius * ridge, n.p.z + nz * radius * ridge);
        wood.nrm.push(nx, ny, nz);
        wood.uv.push((s / sides) * circ, along / BARK_TILE);
        wood.extra[0].push(depthN);
        wood.extra[1].push(dir.x); wood.extra[2].push(dir.y); wood.extra[3].push(dir.z);
        wood.extra[4].push(segStart.x); wood.extra[5].push(segStart.y); wood.extra[6].push(segStart.z);
      }
    }
    const ring = sides + 1;
    for (let i = 0; i < nodes.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * ring + s, b = a + 1, c = a + ring, d = c + 1;
        wood.idx.push(a, c, b, b, c, d);
      }
    }
    // Tip cap (small cone point).
    const tip = nodes[nodes.length - 1];
    const tipIdx = wood.vertexCount;
    wood.pos.push(tip.p.x + dir.x * tip.r, tip.p.y + dir.y * tip.r, tip.p.z + dir.z * tip.r);
    wood.nrm.push(dir.x, dir.y, dir.z);
    wood.uv.push(0, along / BARK_TILE);
    wood.extra[0].push(depthN);
    wood.extra[1].push(dir.x); wood.extra[2].push(dir.y); wood.extra[3].push(dir.z);
    wood.extra[4].push(tip.p.x); wood.extra[5].push(tip.p.y); wood.extra[6].push(tip.p.z);
    const lastRing = base + (nodes.length - 1) * ring;
    for (let s = 0; s < sides; s++) wood.idx.push(lastRing + s, tipIdx, lastRing + s + 1);

    // Collision: trunk and first-order limbs, as a few straight pieces.
    // Trunk (3 pieces) and only the thickest limbs: every collider costs physics time.
    if (!br.root && (br.depth === 0 || (br.depth === 1 && br.nodes[0].r > 0.14 && collision.length < 7))) {
      const pieces = br.depth === 0 ? 3 : 1;
      const per = Math.max(1, Math.floor((nodes.length - 1) / pieces));
      for (let i = 0; i < nodes.length - 1; i += per) {
        const a = nodes[i], b = nodes[Math.min(nodes.length - 1, i + per)];
        const v = b.p.clone().sub(a.p);
        const len = v.length();
        if (len < 0.2) continue;
        collision.push({
          position: a.p.clone(),
          quaternion: new THREE.Quaternion().setFromUnitVectors(up, v.normalize()),
          scale: new THREE.Vector3((a.r + b.r) * 0.5 / 0.25, len, (a.r + b.r) * 0.5 / 0.25),
        });
      }
    }
  }

  // --- Leaves ----------------------------------------------------------------------
  const leaves = new Buf(1); // rand
  let top = 0;
  for (const br of branches) for (const n of br.nodes) top = Math.max(top, n.p.y);
  const crownCenter = new THREE.Vector3(0, top * sp.crownCenter, 0);

  const addCard = (center: THREE.Vector3, normal: THREE.Vector3, tangent: THREE.Vector3, w: number, h: number, bend: number) => {
    const n = normal.clone().normalize();
    const t = tangent.clone().sub(n.clone().multiplyScalar(tangent.dot(n))).normalize();
    const b = n.clone().cross(t).normalize();
    // Soft "volumetric" normal: mostly outward from the crown centre.
    const out = center.clone().sub(crownCenter);
    out.y *= sp.crownFlatten;
    out.normalize();
    const shadeN = n.clone().multiplyScalar(0.3).add(out.multiplyScalar(0.7)).normalize();
    const seg = bend > 0 ? 3 : 1;
    const base = leaves.vertexCount;
    const r = rand();
    for (let j = 0; j <= seg; j++) {
      const v = j / seg;
      const along = (v - (bend > 0 ? 0 : 0.5)) * h;
      const droop = bend * v * v * h; // fronds arch down
      for (let i = 0; i <= 1; i++) {
        const u = i;
        const across = (u - 0.5) * w;
        const px = center.x + t.x * along + b.x * across - n.x * droop;
        const py = center.y + t.y * along + b.y * across - n.y * droop - (bend > 0 ? droop * 0.6 : 0);
        const pz = center.z + t.z * along + b.z * across - n.z * droop;
        leaves.pos.push(px, py, pz);
        leaves.nrm.push(shadeN.x, shadeN.y, shadeN.z);
        leaves.uv.push(u, v);
        leaves.extra[0].push(r);
      }
    }
    for (let j = 0; j < seg; j++) {
      const a = base + j * 2, bb = a + 1, c = a + 2, d = a + 3;
      leaves.idx.push(a, bb, c, bb, d, c);
    }
  };

  const densityMul = low ? 0.45 : 1;
  const [lw, lh] = sp.leafSize;

  if (type === TreeType.PALM) {
    const tip = trunk.nodes[trunk.nodes.length - 1].p;
    const fronds = low ? 7 : 12;
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + rr(-0.2, 0.2);
      const outDir = new THREE.Vector3(Math.cos(a), rr(0.15, 0.6), Math.sin(a)).normalize();
      const center = tip.clone().addScaledVector(outDir, 0.15);
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const normal = outDir.clone().cross(side).normalize();
      if (normal.y < 0) normal.negate();
      addCard(center, normal, outDir, lw * 0.32, rr(lh * 0.85, lh), rr(0.25, 0.4));
    }
  } else if (sp.leafDensity > 0) {
    const effectiveDepth = sp.depth - (low ? 1 : 0);
    const leafMin = Math.max(1, effectiveDepth - 1);
    for (const br of branches) {
      if (br.depth < leafMin && !(sp.whorl && br.depth >= 1)) continue;
      const nodes = br.nodes;
      let acc = 0;
      for (let i = 1; i < nodes.length; i++) {
        const seg = nodes[i].p.clone().sub(nodes[i - 1].p);
        const segLen = seg.length();
        const frac = i / (nodes.length - 1);
        if (frac < (br.depth >= effectiveDepth ? 0.15 : 0.5)) continue;
        acc += segLen * sp.leafDensity * densityMul;
        while (acc >= 1) {
          acc -= 1;
          const center = nodes[i - 1].p.clone().addScaledVector(seg, rand());
          const scatter = sp.leafAlong ? 0.15 : 0.45;
          center.add(new THREE.Vector3(rr(-1, 1), rr(-0.6, 0.8), rr(-1, 1)).multiplyScalar(scatter));
          const dirN = seg.clone().normalize();
          let normal: THREE.Vector3;
          let tangent: THREE.Vector3;
          if (sp.leafAlong) {
            // Needle sprays lie along the twig, facing up-ish.
            tangent = dirN.clone();
            normal = new THREE.Vector3(rr(-0.3, 0.3), 1, rr(-0.3, 0.3)).normalize();
          } else {
            const outward = center.clone().sub(crownCenter).normalize();
            const flat = sp.leafFlat ?? 0.35;
            normal = new THREE.Vector3(rr(-1, 1), rr(-0.3, 1), rr(-1, 1)).normalize()
              .lerp(outward, 0.35).lerp(up, flat).normalize();
            tangent = new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1));
          }
          const s = rr(0.8, 1.2);
          addCard(center, normal, tangent, lw * s, (sp.leafAlong ? lh : lw) * s, 0);
          // A second, crossed card for volume (not for flat acacia crowns).
          if (!low && !sp.leafFlat && rand() < 0.5) {
            addCard(center, tangent.clone().cross(normal).normalize(), normal, lw * s * 0.9, (sp.leafAlong ? lh : lw) * s * 0.9, 0);
          }
        }
      }
    }
  }

  const f32 = (a: number[]) => new Float32Array(a);
  const interleave3 = (x: number[], y: number[], z: number[]) => {
    const out = new Float32Array(x.length * 3);
    for (let i = 0; i < x.length; i++) { out[i * 3] = x[i]; out[i * 3 + 1] = y[i]; out[i * 3 + 2] = z[i]; }
    return out;
  };

  return {
    wood: {
      positions: f32(wood.pos), normals: f32(wood.nrm), uvs: f32(wood.uv), indices: new Uint32Array(wood.idx),
      depth: f32(wood.extra[0]),
      axis: interleave3(wood.extra[1], wood.extra[2], wood.extra[3]),
      origin: interleave3(wood.extra[4], wood.extra[5], wood.extra[6]),
    },
    leaves: {
      positions: f32(leaves.pos), normals: f32(leaves.nrm), uvs: f32(leaves.uv), indices: new Uint32Array(leaves.idx),
      rand: f32(leaves.extra[0]),
    },
    collision,
    height: top,
  };
}
