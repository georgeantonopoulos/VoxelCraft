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

// ============================================================================
// UNIFIED COLOR PALETTE
// These colors match TriplanarMaterial.tsx for world coherence
// ============================================================================

export const ITEM_COLORS = {
    // Stick colors by biome
    stick: {
        default: '#8b5a2b',    // Standard dry wood
        jungle: '#6a4a2a',     // Darker jungle wood
        dry: '#a67c52',        // Lighter desert wood
    },

    // Stone/Rock variants - unified from both UniversalTool and GroundItemsLayer
    stone: {
        default: '#888c8d',    // uColorStone - standard gray
        mountain: '#8c8c96',   // Mountain variant (slightly blue-gray)
        cave: '#4b4b55',       // Cave variant (dark)
        beach: '#b89f7c',      // Beach/sandstone variant
        mossy: '#5c7a3a',      // Moss-covered
        obsidian: '#0a0814',   // Volcanic glass
        basalt: '#2a2a2a',     // Dark volcanic
        sandstone: '#ebd89f',  // Desert stone
        clay: '#a67b5b',       // Terracotta
    },

    // Shard (blade) colors - typically darker/more metallic
    shard: {
        default: '#0a0814',    // Obsidian - sharp blade look
        flint: '#3a3a3a',      // Flint gray
        volcanic: '#1a0a0a',   // Dark red-black
    },

    // Lashing/binding colors
    lashing: {
        leather: '#755339',    // uColorDirt - leather/vine
        fiber: '#4a6b2f',      // uColorMoss - plant fiber
    },

    // Flora (Lumina)
    flora: {
        glow: '#00FFFF',       // Cyan emissive
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
    default: { color: ITEM_COLORS.shard.default, roughness: 0.1, metalness: 0.95 },
    flint: { color: ITEM_COLORS.shard.flint, roughness: 0.2, metalness: 0.8 },
    volcanic: { color: ITEM_COLORS.shard.volcanic, roughness: 0.15, metalness: 0.9, emissive: '#200808', emissiveIntensity: 0.05 },
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
        wraps: 3,
        radius: 0.055,       // Slightly larger than stick radius
        heightSpan: 0.12,
        tubeRadius: 0.008,
        tubularSegments: 32,
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

/**
 * Create stick geometry
 */
export function createStickGeometry(isThumbnail = false): THREE.CylinderGeometry {
    const d = ITEM_DIMENSIONS.stick;
    const key = `stick-${isThumbnail ? 'thumb' : 'world'}`;
    return getCachedGeometry(key, () => new THREE.CylinderGeometry(
        d.radiusTop,
        d.radiusBottom,
        d.height,
        isThumbnail ? d.radialSegmentsThumbnail : d.radialSegments,
        isThumbnail ? d.heightSegmentsThumbnail : d.heightSegments
    )) as THREE.CylinderGeometry;
}

/**
 * Create stone geometry (dodecahedron)
 */
export function createStoneGeometry(isThumbnail = false): THREE.DodecahedronGeometry {
    const d = ITEM_DIMENSIONS.stone;
    const key = `stone-${isThumbnail ? 'thumb' : 'world'}`;
    return getCachedGeometry(key, () => new THREE.DodecahedronGeometry(
        d.radius,
        isThumbnail ? d.detailThumbnail : d.detail
    )) as THREE.DodecahedronGeometry;
}

/**
 * Create shard geometry (octahedron stretched into blade shape)
 * This replaces the cone geometry for a more blade-like appearance
 */
export function createShardGeometry(isThumbnail = false): THREE.BufferGeometry {
    const d = ITEM_DIMENSIONS.shard;
    const key = `shard-${isThumbnail ? 'thumb' : 'world'}`;

    return getCachedGeometry(key, () => {
        // Use octahedron as base - 8 triangular faces, very angular/sharp
        const baseGeom = new THREE.OctahedronGeometry(d.radius, d.detail);

        // Scale non-uniformly to create blade shape:
        // - Narrow in X (thin blade)
        // - Tall in Y (long blade)
        // - Very thin in Z (flat blade)
        const posAttr = baseGeom.attributes.position;
        const positions = posAttr.array as Float32Array;

        for (let i = 0; i < positions.length; i += 3) {
            positions[i] *= d.scaleX;      // X - width
            positions[i + 1] *= d.scaleY;  // Y - height
            positions[i + 2] *= d.scaleZ;  // Z - depth
        }

        posAttr.needsUpdate = true;
        baseGeom.computeVertexNormals();
        baseGeom.computeBoundingSphere();

        return baseGeom;
    });
}

/**
 * Create large rock geometry (icosahedron for boulders)
 */
export function createLargeRockGeometry(): THREE.IcosahedronGeometry {
    const key = 'large-rock';
    return getCachedGeometry(key, () => new THREE.IcosahedronGeometry(1.0, 2)) as THREE.IcosahedronGeometry;
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
    const segments = isThumbnail ? 12 : 24;

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
