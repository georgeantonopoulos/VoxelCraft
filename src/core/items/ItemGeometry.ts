/**
 * ItemGeometry.ts - Unified geometry and material definitions for all items.
 *
 * This is the SINGLE SOURCE OF TRUTH for item visuals.
 * Used by: UniversalTool (held/crafting), GroundItemsLayer (instanced terrain clutter),
 * ItemThumbnail (inventory), PhysicsItem (thrown items).
 *
 * Architecture:
 * - Geometries are created once and cached
 * - Materials use the terrain color palette for visual coherence
 * - Both React declarative and raw THREE.BufferGeometry exports supported
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ============================================================================
// UNIFIED COLOR PALETTE
// These colors match TriplanarMaterial.tsx for world coherence
// ============================================================================

export const ITEM_COLORS = {
    // Stick colors by biome
    stick: {
        default: '#7a654d',    // Weathered deadwood (grey-brown)
        jungle: '#54432f',     // Damp, darker jungle wood
        dry: '#8f7b62',        // Sun-bleached desert wood
    },

    // Stone/Rock variants - unified from both UniversalTool and GroundItemsLayer
    stone: {
        default: '#888c8d',    // uColorStone - standard gray
        mountain: '#86847d',   // Mountain variant (warm grey granite)
        cave: '#55555a',       // Cave variant (dark)
        beach: '#b89f7c',      // Beach/sandstone variant
        mossy: '#6f7266',      // Grey-green stone; the shader adds moss on top
        obsidian: '#0a0814',   // Volcanic glass
        basalt: '#2a2a2a',     // Dark volcanic
        sandstone: '#ebd89f',  // Desert stone
        clay: '#a67b5b',       // Terracotta
    },

    // Shard (blade) colors - typically darker/more metallic
    shard: {
        default: '#5c5850',    // Flint: what a grey field stone knaps into
        flint: '#4d4a44',      // Flint grey-brown
        volcanic: '#2e2222',   // Dark red-black
    },

    // Lashing/binding colors
    lashing: {
        leather: '#5e4e3c',    // Rawhide sinew, weathered (not orange)
        fiber: '#4a6b2f',      // uColorMoss - plant fiber
    },

    // Flora (Lumina)
    flora: {
        glow: '#62e6d8',       // Lumina teal (softer than pure cyan)
        base: '#111111',       // Dark base
    },
} as const;

// ============================================================================
// MATERIAL PROPERTIES
// ============================================================================

export interface MaterialProps {
    color: string;
    roughness: number;
    metalness: number;
    emissive?: string;
    emissiveIntensity?: number;
}

export type StoneVariant = keyof typeof ITEM_COLORS.stone;
export type ShardVariant = keyof typeof ITEM_COLORS.shard;
export type StickVariant = keyof typeof ITEM_COLORS.stick;

export const STONE_MATERIALS: Record<StoneVariant, MaterialProps> = {
    default: { color: ITEM_COLORS.stone.default, roughness: 0.92, metalness: 0.0 },
    mountain: { color: ITEM_COLORS.stone.mountain, roughness: 0.92, metalness: 0.0 },
    cave: { color: ITEM_COLORS.stone.cave, roughness: 0.96, metalness: 0.1 },
    beach: { color: ITEM_COLORS.stone.beach, roughness: 0.85, metalness: 0.0 },
    mossy: { color: ITEM_COLORS.stone.mossy, roughness: 0.93, metalness: 0.0 },
    obsidian: { color: ITEM_COLORS.stone.obsidian, roughness: 0.1, metalness: 0.95, emissive: '#1a0828', emissiveIntensity: 0.1 },
    basalt: { color: ITEM_COLORS.stone.basalt, roughness: 0.6, metalness: 0.4 },
    sandstone: { color: ITEM_COLORS.stone.sandstone, roughness: 0.95, metalness: 0.0 },
    clay: { color: ITEM_COLORS.stone.clay, roughness: 0.85, metalness: 0.0 },
};

export const SHARD_MATERIALS: Record<ShardVariant, MaterialProps> = {
    // Stone and glass are dielectrics: metalness ~0. At 0.8-0.95 they reflected
    // an empty environment and rendered as black slivers.
    default: { color: ITEM_COLORS.shard.default, roughness: 0.34, metalness: 0.0 },
    flint: { color: ITEM_COLORS.shard.flint, roughness: 0.4, metalness: 0.0 },
    volcanic: { color: ITEM_COLORS.shard.volcanic, roughness: 0.22, metalness: 0.0 },
};

export const STICK_MATERIALS: Record<StickVariant, MaterialProps> = {
    default: { color: ITEM_COLORS.stick.default, roughness: 0.92, metalness: 0.0 },
    jungle: { color: ITEM_COLORS.stick.jungle, roughness: 0.90, metalness: 0.0 },
    dry: { color: ITEM_COLORS.stick.dry, roughness: 0.95, metalness: 0.0 },
};

// ============================================================================
// GEOMETRY DIMENSIONS
// These are the canonical sizes used everywhere
// ============================================================================

export const ITEM_DIMENSIONS = {
    stick: {
        radiusTop: 0.045,
        radiusBottom: 0.04,
        height: 0.95,
        radialSegments: 8,
        heightSegments: 8,
        // For thumbnails (lower quality)
        radialSegmentsThumbnail: 6,
        heightSegmentsThumbnail: 4,
    },
    stone: {
        radius: 0.22,
        detail: 1,           // Subdivision level for world rendering
        detailThumbnail: 0,  // No subdivision for thumbnails
    },
    shard: {
        // Octahedron stretched vertically for blade-like appearance
        radius: 0.12,
        detail: 0,
        // Scale factors to stretch into blade shape
        scaleX: 0.6,
        scaleY: 1.8,
        scaleZ: 0.3,
    },
    flora: {
        mainRadius: 0.2,
        secondaryRadius: 0.12,
        tertiaryRadius: 0.1,
        segments: 16,
        segmentsThumbnail: 8,
    },
    lashing: {
        // Tight turns hugging the stick (a loose 3-turn helix read as a spring).
        wraps: 7,
        radius: 0.049,       // stick radius + the cord
        heightSpan: 0.09,
        tubeRadius: 0.0055,
        tubularSegments: 112,
        radialSegments: 6,
        tubularSegmentsThumbnail: 16,
        radialSegmentsThumbnail: 4,
    },
} as const;

// ============================================================================
// GEOMETRY CACHE
// Lazily created and cached for reuse
// ============================================================================

const geometryCache: Record<string, THREE.BufferGeometry> = {};

function getCachedGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    if (!geometryCache[key]) {
        geometryCache[key] = factory();
    }
    return geometryCache[key];
}

// ============================================================================
// GEOMETRY FACTORIES
// ============================================================================

// ----------------------------------------------------------------------------
// Procedural shape helpers (deterministic; independent of the world seed)
// ----------------------------------------------------------------------------

const hash3 = (x: number, y: number, z: number, s: number): number => {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
    return h - Math.floor(h);
};

/** Smooth 3D value noise in [0, 1]. */
function valueNoise(x: number, y: number, z: number, s: number): number {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, s);
    return lerp(
        lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
        lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
        w,
    );
}

function fbm3(x: number, y: number, z: number, s: number, octaves: number): number {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += amp * valueNoise(x * f, y * f, z * f, s + i * 7.1);
        norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm;
}

/**
 * A natural stone: a subdivided sphere pushed by multi-octave noise, squashed
 * (river and field stones are flatter than they are wide) and cut by a few
 * planes, which read as fracture faces. `variant` picks one of several shapes.
 */
export function buildRockGeometry(radius: number, variant: number, detail = 3, flatten = 0.62): THREE.BufferGeometry {
    // Polyhedra are built unindexed; welding shares vertices so the noise moves
    // them together (no cracks) and normals come out smooth, not faceted.
    const base = new THREE.IcosahedronGeometry(1, detail);
    base.deleteAttribute('uv');
    const g = mergeVertices(base);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const s = variant * 13.37 + 1.0;
    const stretchX = 1.0 + (hash3(s, 1, 2, 3) - 0.5) * 0.45;
    const stretchZ = 1.0 + (hash3(s, 4, 5, 6) - 0.5) * 0.35;
    // Fracture planes: normal and offset (a cut removes everything beyond it).
    const cuts: Array<{ n: THREE.Vector3; d: number }> = [];
    const cutCount = 2 + Math.floor(hash3(s, 7, 8, 9) * 3);
    for (let i = 0; i < cutCount; i++) {
        const n = new THREE.Vector3(hash3(s, i, 1, 10) - 0.5, (hash3(s, i, 2, 11) - 0.5) * 1.4, hash3(s, i, 3, 12) - 0.5).normalize();
        cuts.push({ n, d: 0.62 + hash3(s, i, 4, 13) * 0.25 });
    }
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = fbm3(v.x * 1.6, v.y * 1.6, v.z * 1.6, s, 4);
        const bump = fbm3(v.x * 5.5, v.y * 5.5, v.z * 5.5, s + 3.3, 2);
        v.multiplyScalar(0.78 + n * 0.42 + (bump - 0.5) * 0.06);
        for (const c of cuts) {
            const over = v.dot(c.n) - c.d;
            if (over > 0) v.addScaledVector(c.n, -over * 0.92);
        }
        v.set(v.x * stretchX, v.y * flatten, v.z * stretchZ);
        // Flatter underside so it sits on the ground.
        if (v.y < -0.35 * flatten) v.y = -0.35 * flatten + (v.y + 0.35 * flatten) * 0.35;
        v.multiplyScalar(radius);
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
    g.computeBoundingSphere();
    return g;
}

/**
 * Stick geometry for the hand and crafting bench: straight axis (attachment
 * slots sit on it) with a gentle taper and an irregular, knobbly profile.
 */
export function createStickGeometry(isThumbnail = false): THREE.BufferGeometry {
    const d = ITEM_DIMENSIONS.stick;
    const key = `stick-${isThumbnail ? 'thumb' : 'world'}`;
    return getCachedGeometry(key, () => {
        const g = new THREE.CylinderGeometry(
            d.radiusTop, d.radiusBottom, d.height,
            isThumbnail ? d.radialSegmentsThumbnail : 9,
            isThumbnail ? d.heightSegmentsThumbnail : 14,
        );
        const pos = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const r = Math.hypot(x, z);
            if (r < 1e-5) continue;
            const a = Math.atan2(z, x);
            const t = y / d.height + 0.5;
            const k = 1 + (fbm3(Math.cos(a) * 1.5, t * 6, Math.sin(a) * 1.5, 5.1, 3) - 0.5) * 0.35 - t * 0.12;
            pos.setX(i, x * k); pos.setZ(i, z * k);
        }
        g.computeVertexNormals();
        return g;
    });
}

/**
 * Unit fallen branch for instanced ground sticks (scaled per instance: x/z by
 * radius, y by length). Tapered, slightly bent, with a broken side twig, so
 * sticks no longer read as identical straight dowels.
 */
export function createGroundStickGeometry(): THREE.BufferGeometry {
    return getCachedGeometry('stick-ground', () => {
        const main = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.0, -0.5, 0),
            new THREE.Vector3(0.35, -0.2, 0.1),
            new THREE.Vector3(0.2, 0.15, -0.1),
            new THREE.Vector3(-0.35, 0.5, 0.05),
        ]);
        const tube = (curve: THREE.Curve<THREE.Vector3>, segs: number, r0: number, r1: number, rad: number) => {
            const g = new THREE.TubeGeometry(curve, segs, 1, rad, false);
            const pos = g.attributes.position as THREE.BufferAttribute;
            const p = new THREE.Vector3();
            // Rescale each ring around its centre to taper r0 -> r1.
            for (let i = 0; i <= segs; i++) {
                const t = i / segs;
                const c = curve.getPointAt(t);
                const r = THREE.MathUtils.lerp(r0, r1, t) * (0.9 + 0.2 * valueNoise(t * 9, 0.5, 0.5, 2.2));
                for (let j = 0; j <= rad; j++) {
                    const idx = i * (rad + 1) + j;
                    p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
                    pos.setXYZ(idx, p.x, p.y, p.z);
                }
            }
            g.computeVertexNormals();
            return g;
        };
        const branch = tube(main, 14, 1.0, 0.65, 7);
        const twigCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.3, -0.12, 0.05),
            new THREE.Vector3(1.6, 0.0, 0.4),
            new THREE.Vector3(3.2, 0.1, 0.9),
        ]);
        const twig = tube(twigCurve, 5, 0.5, 0.25, 5);
        const merged = mergeGeometriesSimple([branch, twig]);
        merged.computeBoundingSphere();
        return merged;
    });
}

/** Merge non-indexed-compatible geometries (position/normal/uv only). */
function mergeGeometriesSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv'] as const) {
        const size = flat[0].getAttribute(name).itemSize;
        const total = flat.reduce((n, g) => n + g.getAttribute(name).count * size, 0);
        const arr = new Float32Array(total);
        let off = 0;
        for (const g of flat) { const a = g.getAttribute(name).array as Float32Array; arr.set(a, off); off += a.length; }
        out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    return out;
}

/** Hand-sized stone (held, thrown, crafting). */
export function createStoneGeometry(isThumbnail = false, variant = 0): THREE.BufferGeometry {
    const d = ITEM_DIMENSIONS.stone;
    const key = `stone-${isThumbnail ? 'thumb' : 'world'}-${variant}`;
    return getCachedGeometry(key, () => buildRockGeometry(d.radius, variant, isThumbnail ? 2 : 3));
}

/**
 * Knapped stone flake: a pointed, leaf-shaped blade that is thick along a
 * central ridge and thin at the edges, with flat facets (flake scars) on both
 * faces. Tip at +Y, blade in the XY plane (as the crafting slots expect).
 */
export function createShardGeometry(isThumbnail = false): THREE.BufferGeometry {
    const key = `shard-${isThumbnail ? 'thumb' : 'world'}`;
    return getCachedGeometry(key, () => {
        // A hand-sized flake (~22 cm): the size a fist stone actually yields.
        const L = 0.22, W = 0.05, T = 0.018, edge = 0.003;
        const N = 12; // outline points per side
        const outline: Array<[number, number]> = [];
        // Right side from tip down to the butt, then left side back up.
        for (let i = 0; i <= N; i++) {
            const t = i / N; // 0 tip, 1 butt
            const y = L / 2 - t * L;
            const w = W * Math.pow(Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5), 0.8) * (t > 0.85 ? 1 - (t - 0.85) * 2.5 : 1);
            const jag = (hash3(i, 1, 0, 3.3) - 0.5) * 0.007 * (t > 0.08 ? 1 : 0);
            outline.push([w + jag, y]);
        }
        for (let i = N - 1; i >= 1; i--) {
            const [x, y] = outline[i];
            outline.push([-x + (hash3(i, 2, 0, 4.4) - 0.5) * 0.007, y]);
        }
        const ridge = (y: number) => {
            const t = (L / 2 - y) / L;
            return T * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5) * (t > 0.9 ? 1 - (t - 0.9) * 4 : 1);
        };
        const verts: number[] = [];
        // Emit a triangle facing `want` (flip the winding if it does not).
        const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
        const tri = (a: number[], b: number[], c: number[], want: THREE.Vector3) => {
            e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
            nrm.crossVectors(e1, e2);
            if (nrm.dot(want) < 0) verts.push(...a, ...c, ...b); else verts.push(...a, ...b, ...c);
        };
        const M = outline.length;
        const up = new THREE.Vector3(0, 0, 1), down = new THREE.Vector3(0, 0, -1);
        for (const side of [1, -1]) {
            const want = side > 0 ? up : down;
            // One ridge point per outline segment, slightly jittered: the faces
            // between them are the flat flake scars.
            const ridgePts = outline.map(([x0, y0], i) => {
                const [x1, y1] = outline[(i + 1) % M];
                const my = (y0 + y1) / 2;
                const rx = (x0 + x1) * 0.12 + (hash3(i, side, 5, 6.6) - 0.5) * 0.007;
                return [rx, my, side * ridge(my)];
            });
            for (let i = 0; i < M; i++) {
                const a = [outline[i][0], outline[i][1], side * edge];
                const b = [outline[(i + 1) % M][0], outline[(i + 1) % M][1], side * edge];
                const r0 = ridgePts[i], r1 = ridgePts[(i + 1) % M];
                tri(a, r0, b, want);
                tri(b, r0, r1, want); // closes the gap between neighbouring scars
            }
            // Fill the thin ridge polygon from a centre point on the crest.
            const centre = [0, 0, side * ridge(0) * 1.04];
            for (let i = 0; i < M; i++) tri(centre, ridgePts[i], ridgePts[(i + 1) % M], want);
        }
        // Thin edge band between the faces, facing outward.
        const out = new THREE.Vector3();
        for (let i = 0; i < M; i++) {
            const [x0, y0] = outline[i];
            const [x1, y1] = outline[(i + 1) % M];
            out.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
            tri([x0, y0, edge], [x1, y1, edge], [x1, y1, -edge], out);
            tri([x0, y0, edge], [x1, y1, -edge], [x0, y0, -edge], out);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((verts.length / 3) * 2), 2));
        g.computeVertexNormals(); // non-indexed: flat facets
        g.computeBoundingSphere();
        return g;
    });
}

/** Boulder (unit radius; scaled per instance). */
export function createLargeRockGeometry(): THREE.BufferGeometry {
    return getCachedGeometry('large-rock', () => buildRockGeometry(1.0, 7, 3, 0.72));
}

/**
 * Lumina plant: a few dark, arching stems ending in drooping, glowing pods,
 * with two leaves at the base. Base at y = 0, about 0.34 m tall. Returned as
 * two geometries so pods get the glowing material and stems a plain one.
 * Used for world flora (LuminaLayer), placed/thrown flora (LuminaFlora) and
 * the held/crafting item (UniversalTool FloraMesh).
 */
export function createLuminaPlantGeometry(): { stems: THREE.BufferGeometry; pods: THREE.BufferGeometry } {
    const stems = getCachedGeometry('lumina-stems', () => {
        const parts: THREE.BufferGeometry[] = [];
        const count = 4;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + hash3(i, 1, 2, 8.1) * 0.9;
            const h = 0.2 + hash3(i, 2, 3, 8.2) * 0.12;
            const out = 0.05 + hash3(i, 3, 4, 8.3) * 0.05;
            const ca = Math.cos(a), sa = Math.sin(a);
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(ca * out * 0.4, h * 0.55, sa * out * 0.4),
                new THREE.Vector3(ca * out, h, sa * out),
                new THREE.Vector3(ca * out * 1.35, h - 0.035, sa * out * 1.35), // droop
            ]);
            parts.push(new THREE.TubeGeometry(curve, 18, 0.006, 5, false));
        }
        // Two leaves at the base.
        for (let i = 0; i < 2; i++) {
            const leaf = new THREE.SphereGeometry(1, 8, 4);
            leaf.scale(0.07, 0.006, 0.025);
            leaf.translate(0.06, 0.012, 0);
            leaf.rotateZ(0.35);
            leaf.rotateY(i * Math.PI + 0.6);
            parts.push(leaf);
        }
        const g = mergeGeometriesSimple(parts);
        g.computeBoundingSphere();
        return g;
    });
    const pods = getCachedGeometry('lumina-pods', () => {
        const parts: THREE.BufferGeometry[] = [];
        const count = 4;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + hash3(i, 1, 2, 8.1) * 0.9;
            const h = 0.2 + hash3(i, 2, 3, 8.2) * 0.12;
            const out = 0.05 + hash3(i, 3, 4, 8.3) * 0.05;
            const r = 0.022 + hash3(i, 4, 5, 8.4) * 0.014;
            // Teardrop pod hanging from the stem tip.
            const pod = new THREE.SphereGeometry(1, 12, 10);
            const pos = pod.attributes.position as THREE.BufferAttribute;
            for (let k = 0; k < pos.count; k++) {
                const y = pos.getY(k);
                const taper = y > 0 ? 1 - y * 0.55 : 1;
                pos.setXYZ(k, pos.getX(k) * taper * r, y * r * 1.35, pos.getZ(k) * taper * r);
            }
            pod.computeVertexNormals();
            pod.translate(Math.cos(a) * out * 1.35, h - 0.035 - r * 1.1, Math.sin(a) * out * 1.35);
            parts.push(pod);
        }
        const g = mergeGeometriesSimple(parts);
        g.computeBoundingSphere();
        return g;
    });
    return { stems, pods };
}

/**
 * Create flora (Lumina) geometry - returns dimensions for composite mesh
 */
export function getFloraGeometryConfig(isThumbnail = false) {
    const d = ITEM_DIMENSIONS.flora;
    const segs = isThumbnail ? d.segmentsThumbnail : d.segments;
    return {
        main: { radius: d.mainRadius, segments: segs },
        secondary: { radius: d.secondaryRadius, segments: Math.floor(segs * 0.75), position: [0.12, -0.08, 0.08] as [number, number, number] },
        tertiary: { radius: d.tertiaryRadius, segments: Math.floor(segs * 0.75), position: [-0.12, -0.12, -0.04] as [number, number, number] },
    };
}

/**
 * Create lashing (binding wrap) geometry using helix curve
 */
export function createLashingGeometry(slotId: string, isThumbnail = false): THREE.TubeGeometry {
    const d = ITEM_DIMENSIONS.lashing;
    const key = `lashing-${slotId}-${isThumbnail ? 'thumb' : 'world'}`;

    // Don't cache lashing geometry as it depends on slotId
    const points: THREE.Vector3[] = [];
    const segments = (isThumbnail ? 6 : 16) * d.wraps;

    // Direction alternates based on slot
    const direction = slotId === 'side_right' ? -1 : 1;

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = t * Math.PI * 2 * d.wraps * direction;
        const y = (t - 0.5) * d.heightSpan;
        const x = Math.cos(angle) * d.radius;
        const z = Math.sin(angle) * d.radius;
        points.push(new THREE.Vector3(x, y, z));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(
        curve,
        isThumbnail ? d.tubularSegmentsThumbnail : d.tubularSegments,
        d.tubeRadius,
        isThumbnail ? d.radialSegmentsThumbnail : d.radialSegments,
        false
    );
}

// ============================================================================
// VARIANT SELECTION HELPERS
// ============================================================================

/**
 * Get a deterministic stone variant from a seed value
 */
export function getStoneVariantFromSeed(seed: number): StoneVariant {
    const variants: StoneVariant[] = ['default', 'mountain', 'cave', 'beach', 'mossy', 'obsidian', 'basalt', 'sandstone', 'clay'];
    const index = Math.floor(Math.abs(seed * 43758.5453) % variants.length);
    return variants[index];
}

/**
 * Get a deterministic shard variant from a seed value
 */
export function getShardVariantFromSeed(seed: number): ShardVariant {
    const variants: ShardVariant[] = ['default', 'flint', 'volcanic'];
    const index = Math.floor(Math.abs(seed * 12345.6789) % variants.length);
    return variants[index];
}

/**
 * Map RockVariant enum (from GroundItemKinds) to our StoneVariant
 */
export function rockVariantToStoneVariant(rockVariant: number): StoneVariant {
    // RockVariant enum: MOUNTAIN=0, CAVE=1, BEACH=2, MOSSY=3
    const mapping: StoneVariant[] = ['mountain', 'cave', 'beach', 'mossy'];
    return mapping[rockVariant] ?? 'default';
}

// ============================================================================
// DISPOSAL
// ============================================================================

/**
 * Dispose all cached geometries (call on app shutdown)
 */
export function disposeItemGeometries(): void {
    for (const key in geometryCache) {
        geometryCache[key].dispose();
        delete geometryCache[key];
    }
}
