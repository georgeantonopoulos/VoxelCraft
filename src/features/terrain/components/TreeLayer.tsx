import React, { useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies, InstancedRigidBodyProps } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';
import { getLeafTexture } from '@features/flora/trees/leafAtlas';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

// Type for pre-computed tree instance data from worker
interface TreeInstanceBatch {
    type: number;
    variant: number;
    count: number;
    matrices: Float32Array;
    originalIndices: Int32Array;
}

interface TreeLayerProps {
    data: Float32Array; // Stride 4: x, y, z, type (fallback if no pre-computed data)
    treeInstanceBatches?: Record<string, TreeInstanceBatch>; // Pre-computed from worker
    collidersEnabled: boolean;
    chunkKey: string;
    simplified?: boolean;
    lodLevel?: number;
}

/**
 * A struck tree shudders: trunk and crown shake and settle over ~1 s. One
 * shared hit (uTreeHitPos/uTreeHitTime, set by useTerrainInteraction) picks
 * the instance whose base is there; the rest of the forest is untouched.
 */
const TREE_HIT_GLSL = /* glsl */ `
    uniform vec3 uTreeHitPos;
    uniform float uTreeHitTime;
    float treeHitShake(float heightFactor) {
        vec3 o = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        float ht = uTime - uTreeHitTime;
        float near = 1.0 - step(0.8, distance(o.xz, uTreeHitPos.xz));
        float live = step(0.0, ht) * (1.0 - step(1.6, ht));
        return near * live * exp(-ht * 4.0) * sin(ht * 24.0) * heightFactor;
    }
`;

/** Far crowns dissolve between these distances (m), inside the fog. */
const LEAF_FADE_START = 84;
const LEAF_FADE_END = 100;

export const TreeLayer: React.FC<TreeLayerProps> = React.memo(({ data, treeInstanceBatches, collidersEnabled, chunkKey, simplified, lodLevel = 0 }) => {

    // Use pre-computed batches if available, otherwise fall back to client-side batching
    const batches = useMemo(() => {
        // If we have pre-computed batches from worker, use them directly
        if (treeInstanceBatches && Object.keys(treeInstanceBatches).length > 0) {
            return treeInstanceBatches;
        }

        // Fallback: compute batches on main thread (legacy path)
        const map: Record<string, TreeInstanceBatch> = {};
        const JUNGLE_VARIANTS = 4;
        const positionsByKey: Record<string, number[]> = {};
        const scalesByKey: Record<string, number[]> = {};
        const originalIndicesByKey: Record<string, number[]> = {};
        const STRIDE = 5;

        for (let i = 0; i < data.length; i += STRIDE) {
            const x = data[i];
            const y = data[i + 1];
            const z = data[i + 2];
            const type = data[i + 3];
            const scaleFactor = data[i + 4];

            let variant = 0;
            if (type === TreeType.JUNGLE) {
                const seed = x * 12.9898 + z * 78.233;
                const h = Math.abs(Math.sin(seed)) * 43758.5453;
                variant = Math.floor((h % 1) * JUNGLE_VARIANTS);
            }

            const key = `${type}:${variant}`;
            if (!positionsByKey[key]) {
                positionsByKey[key] = [];
                scalesByKey[key] = [];
                originalIndicesByKey[key] = [];
            }
            positionsByKey[key].push(x, y, z);
            scalesByKey[key].push(scaleFactor);
            originalIndicesByKey[key].push(i);
        }

        // Build matrices
        for (const [key, positions] of Object.entries(positionsByKey)) {
            const [typeStr, variantStr] = key.split(':');
            const type = parseInt(typeStr);
            const variant = parseInt(variantStr);
            const scales = scalesByKey[key];
            const originalIndices = originalIndicesByKey[key];
            const count = positions.length / 3;
            const matrices = new Float32Array(count * 16);
            const indices = new Int32Array(originalIndices);

            for (let i = 0; i < count; i++) {
                const x = positions[i * 3];
                const y = positions[i * 3 + 1];
                const z = positions[i * 3 + 2];
                const scale = scales[i];

                const seed = x * 12.9898 + z * 78.233;
                const rotY = (seed % 1) * Math.PI * 2;

                const c = Math.cos(rotY);
                const s = Math.sin(rotY);

                const offset = i * 16;
                matrices[offset + 0] = c * scale;
                matrices[offset + 1] = 0;
                matrices[offset + 2] = -s * scale;
                matrices[offset + 3] = 0;
                matrices[offset + 4] = 0;
                matrices[offset + 5] = scale;
                matrices[offset + 6] = 0;
                matrices[offset + 7] = 0;
                matrices[offset + 8] = s * scale;
                matrices[offset + 9] = 0;
                matrices[offset + 10] = c * scale;
                matrices[offset + 11] = 0;
                matrices[offset + 12] = x;
                matrices[offset + 13] = y;
                matrices[offset + 14] = z;
                matrices[offset + 15] = 1;
            }

            map[key] = { type, variant, count, matrices, originalIndices: indices };
        }

        return map;
    }, [data, treeInstanceBatches]);

    return (
        <group>
            {Object.entries(batches).map(([key, batch]) => (
                <InstancedTreeBatch
                    key={key}
                    type={batch.type}
                    variant={batch.variant}
                    matrices={batch.matrices}
                    originalIndices={batch.originalIndices}
                    count={batch.count}
                    collidersEnabled={collidersEnabled}
                    chunkKey={chunkKey}
                    simplified={simplified}
                    lodLevel={lodLevel}
                />
            ))}
        </group>
    );
});

/** Bark and leaf-tip colours per tree type. */
export const treeColors = (type: number): { base: string; tip: string } => {
    // Bark: warm grey-browns (red-browns read mauve under the cool sky fill).
    if (type === TreeType.OAK) return { base: '#5b4a38', tip: '#4CAF50' };
    if (type === TreeType.PINE) return { base: '#4d3b2a', tip: '#1B5E20' };
    if (type === TreeType.PALM) return { base: '#795548', tip: '#8BC34A' };
    if (type === TreeType.ACACIA) return { base: '#6e5b45', tip: '#CDDC39' };
    if (type === TreeType.CACTUS) return { base: '#2E7D32', tip: '#43A047' };
    if (type === TreeType.JUNGLE) return { base: '#56483a', tip: '#2E7D32' };
    return { base: '#3e2723', tip: '#00FFFF' };
};

/** A tree type's own bark material (instanced meshes only): the stump of a felled tree. */
export const getTreeBarkMaterial = (type: number): THREE.Material => getTreeWoodMaterial(type, treeColors(type));

// Material pools for trees to avoid per-chunk creation.
const treeWoodMaterialPool: Record<string, THREE.Material> = {};
const treeLeafMaterialPool: Record<string, THREE.Material> = {};

const getTreeWoodMaterial = (type: number, colors: any, variant: { key: string; moss: number; barkScale: [number, number] } = { key: '', moss: 1, barkScale: [1, 1] }) => {
    const key = `${type}${variant.key}`;
    if (treeWoodMaterialPool[key]) return treeWoodMaterialPool[key];

    treeWoodMaterialPool[key] = new (CustomShaderMaterial as any)({
        baseMaterial: THREE.MeshStandardMaterial,
        vertexShader: `
            attribute float aBranchDepth;
            attribute vec3 aBranchAxis;
            attribute vec3 aBranchOrigin;
            uniform float uTime;
            varying float vDepth;
            varying vec3 vPos;
            varying vec3 vWorldNormal;
            varying vec3 vBranchAxis;
            varying vec3 vBranchOrigin;
            ${TREE_HIT_GLSL}

            void main() {
                vDepth = aBranchDepth;
                vPos = position;
                vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
                vBranchAxis = aBranchAxis;
                vBranchOrigin = aBranchOrigin;
                
                float windStrength = 0.08 * pow(aBranchDepth, 2.0);
                float time = uTime * 1.5;
                float phase = position.x + position.z; 
                float sway = sin(time + phase) * windStrength + sin(time * 0.5 + phase * 0.5) * windStrength * 0.5;
                
                vec3 pos = position;
                pos.x += sway;
                pos.z += sway * 0.5;
                float shudder = treeHitShake(clamp(position.y / 6.0, 0.0, 1.5));
                pos.x += shudder * 0.07;
                pos.z += shudder * 0.045;
                csm_Position = pos;
            }
        `,
        fragmentShader: `
            precision highp sampler3D;
            varying float vDepth;
            varying vec3 vPos;
            varying vec3 vWorldNormal;
            varying vec3 vBranchAxis;
            varying vec3 vBranchOrigin;

            uniform vec3 uColorBase;
            uniform vec3 uColorTip;
            uniform sampler3D uNoiseTexture;
            uniform float uMoss;
            uniform vec2 uBarkScale; // around, along

            void main() {
                vec3 axis = normalize(vBranchAxis);
                vec3 ref = (abs(axis.y) < 0.99) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
                vec3 tangent = normalize(cross(ref, axis));
                vec3 bitangent = cross(axis, tangent);

                vec3 rel = vPos - vBranchOrigin;
                float along = dot(rel, axis);
                vec3 radial = rel - axis * along;
                float x = dot(radial, tangent);
                float z = dot(radial, bitangent);
                float angle = ((abs(x) + abs(z)) < 1e-6 ? 0.0 : atan(x, z));

                // Multi-scale noise in real distances: arc length around the
                // branch and length along it (~2.4:1 vertical furrows, a few cm apart). Angle
                // alone gave twigs and trunks the same feature count around,
                // smearing bark into long streaks on thin branches.
                float nBase = texture(uNoiseTexture, vPos * 0.35 + vec3(7.0)).r;
                float rad = max(length(radial), 0.015);
                vec3 barkP = vec3(cos(angle) * rad * 12.0 * uBarkScale.x, sin(angle) * rad * 12.0 * uBarkScale.x, along * 5.0 * uBarkScale.y);
                float nBark = texture(uNoiseTexture, barkP).r;
                float nFine = texture(uNoiseTexture, barkP * 3.0 + vec3(3.0)).g;
                float nMicro = texture(uNoiseTexture, vPos * 5.0).b;

                float ridges = smoothstep(0.3, 0.7, nBark);
                float crevices = 1.0 - ridges;

                // Fine vertical bark fibers
                // (vertical: they vary around the branch, not along it)
                float fiberDetail = sin(angle * rad * 70.0 + nFine * 6.0) * 0.5 + 0.5;
                fiberDetail *= smoothstep(0.3, 0.6, nFine);

                // Micro pores and lichens
                float pores = smoothstep(0.55, 0.6, nMicro);
                float lichens = smoothstep(0.7, 0.75, nFine) * smoothstep(0.5, 0.55, nMicro);

                // Base color with variation
                vec3 col = uColorBase;
                col *= mix(0.88, 1.08, nBase * 0.6);

                // Color temperature variation
                col.r *= 1.0 + (nFine - 0.5) * 0.06;
                col.b *= 1.0 - (nFine - 0.5) * 0.04;

                // Darken crevices
                col *= mix(1.0, 0.45, crevices * 0.85);

                // Fiber highlights on ridges
                col += vec3(0.03, 0.025, 0.02) * fiberDetail * ridges;

                // Micro pore darkening
                col *= 1.0 - pores * 0.15;

                // Lichen patches
                vec3 lichenColor = vec3(0.38, 0.45, 0.35);
                col = mix(col, lichenColor, lichens * 0.5);

                // Moss on upward-facing surfaces
                float mossNoise = texture(uNoiseTexture, vPos * 0.55 + vec3(5.0)).g;
                float mossDetail = texture(uNoiseTexture, vPos * 3.0).r;
                float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                if (upFactor > 0.2 && mossNoise > 0.45) {
                    vec3 mossCol = vec3(0.1, 0.48, 0.1);
                    mossCol *= 0.85 + mossDetail * 0.3;
                    float mossMix = (mossNoise - 0.45) * 3.0 * upFactor;
                    col = mix(col, mossCol, mossMix * 0.7 * uMoss);
                }

                // Wet sheen in crevices
                float wetSheen = crevices * nMicro * 0.12;
                col += vec3(0.015) * wetSheen;

                csm_DiffuseColor = vec4(col, 1.0);

                // Variable roughness
                float rough = 0.72;
                rough += crevices * 0.18;
                rough -= fiberDetail * ridges * 0.12;
                rough += lichens * 0.08;
                rough -= wetSheen * 0.25;
                csm_Roughness = clamp(rough, 0.45, 1.0);
            }
        `,
        uniforms: {
            uColorBase: { value: new THREE.Color(colors.base) },
            uColorTip: { value: new THREE.Color(colors.tip) },
            uNoiseTexture: { value: getNoiseTexture() },
            uMoss: { value: variant.moss },
            uBarkScale: { value: new THREE.Vector2(...variant.barkScale) },
            ...sharedUniforms,
            uIsInstanced: { value: 1.0 },
        },
        roughness: 0.9,
        toneMapped: false,
    });

    return treeWoodMaterialPool[key];
};

/**
 * The trees' bark shader for the Root Hollow stump: long-dead, weathered grey
 * oak with only a trace of moss (the hollow sits in drained ground). Instanced meshes only.
 */
export const getHollowBarkMaterial = (): THREE.Material =>
    getTreeWoodMaterial(TreeType.OAK, { base: '#62584c', tip: '#4CAF50' }, { key: ':hollow', moss: 0.22, barkScale: [0.8, 0.22] });

/**
 * One leaf material per tree type, shared by both LODs. Far crowns fade out by
 * each tree's own distance (dithered, inside the fog), not by chunk LOD tier:
 * per-chunk alpha steps thinned every crown in a chunk at once as the player
 * crossed a chunk border.
 */
const getTreeLeafMaterial = (type: number, colors: any) => {
    const key = `${type}`;
    const pool = treeLeafMaterialPool;
    if (pool[key]) return pool[key];

    pool[key] = new (CustomShaderMaterial as any)({
        baseMaterial: THREE.MeshStandardMaterial,
        // Cut-out cards (discard in the shader): opaque rendering, no sorting.
        transparent: false,
        vertexShader: `
            uniform float uTime;
            uniform float uLeafHueVariation;
            ${TREE_HIT_GLSL}
            attribute float aLeafRand;
            varying vec3 vPos;
            varying vec3 vWorldNormal;
            varying vec3 vNoisePos;
            varying float vLeafRand;
            varying float vTreeSeed;
            varying float vHueCos;
            varying float vHueSin;
            varying vec2 vLeafUv;
            varying float vTreeDist;

            float hash11(float p) {
                return fract(sin(p) * 43758.5453123);
            }

            void main() {
                vLeafUv = uv;
                vPos = position;
                vWorldNormal = normalize(mat3(modelMatrix) * normal);
                vTreeDist = distance(cameraPosition, (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz);
                vTreeSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453123);
                vec3 treeNoiseOffset = vec3(vTreeSeed * 50.0, vTreeSeed * 37.0, vTreeSeed * 23.0);
                vNoisePos = position + treeNoiseOffset;
                vLeafRand = aLeafRand;

                float hueN = hash11(aLeafRand * 113.1 + vTreeSeed * 19.7);
                float hueAngle = (hueN * 2.0 - 1.0) * uLeafHueVariation;
                vHueCos = cos(hueAngle);
                vHueSin = sin(hueAngle);
                
                float swayStrength = 0.1;
                float time = uTime * 1.5;
                float phase = position.x + position.z + instanceMatrix[3][0]; 

                float sway = sin(time + phase) * swayStrength;
                vec3 pos = position;
                pos.x += sway; 
                float wobble = sin(time * 3.0 + phase * 2.0) * 0.05;
                pos.y += wobble;
                float shudder = treeHitShake(clamp(position.y / 6.0, 0.0, 1.5));
                pos.x += shudder * 0.13;
                pos.z += shudder * 0.08;
                pos.y += shudder * 0.03;

                csm_Position = pos;
            }
        `,
        fragmentShader: `
            precision highp sampler3D;
            varying vec3 vPos;
            varying vec3 vNoisePos;
            varying float vTreeSeed;
            varying float vHueCos;
            varying float vHueSin;
            varying float vLeafRand;
            varying vec3 vWorldNormal;
            uniform vec3 uColorTip;
            uniform sampler3D uNoiseTexture;
            uniform float uTime;
            varying float vTreeDist;
            uniform sampler2D uLeafMap;
            varying vec2 vLeafUv;

            vec3 hueRotateCS(vec3 color, float c, float s) {
                vec3 k = vec3(0.57735026919);
                return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
            }

            void main() {
                float lodRand = fract(sin(vLeafRand * 173.1 + vTreeSeed * 19.7) * 43758.5453123);
                float keep = 1.0 - smoothstep(${LEAF_FADE_START.toFixed(1)}, ${LEAF_FADE_END.toFixed(1)}, vTreeDist);
                if (lodRand > keep) {
                    discard;
                }

                // Leaf card texture (species atlas). Alpha is sharpened by its screen
                // derivative so cut-outs stay crisp and coverage survives mipmapping
                // (plain alpha test makes distant crowns thin out).
                vec4 leafTex = texture(uLeafMap, vLeafUv);
                float cover = (leafTex.a - 0.45) / max(fwidth(leafTex.a), 1e-4) + 0.5;
                if (cover < 0.5) discard;

                float variation = texture(uNoiseTexture, vNoisePos * 0.15).r;
                float treeBrightness = 0.82 + vTreeSeed * 0.3;
                float treeSaturation = 0.8 + fract(vTreeSeed * 7.3) * 0.25;

                vec3 col = leafTex.rgb * treeBrightness * mix(0.9, 1.1, variation);
                // Per-card variation: some clusters sunnier/yellower, some deeper.
                col *= mix(vec3(0.92, 1.0, 0.9), vec3(1.08, 1.04, 0.86), fract(vLeafRand * 7.13));
                float lum = dot(col, vec3(0.299, 0.587, 0.114));
                col = mix(vec3(lum), col, treeSaturation);
                col = clamp(hueRotateCS(col, vHueCos, vHueSin), 0.0, 1.0);

                csm_DiffuseColor = vec4(col, 1.0);
                // Light passing through the leaf when it faces away from the sun.
                csm_Emissive = col * 0.05;
                csm_Roughness = 0.82; // matte: glossy cards glinted white in distant crowns
            }
        `,
        uniforms: {
            uColorTip: { value: new THREE.Color(colors.tip) },
            uNoiseTexture: { value: getNoiseTexture() },
            ...sharedUniforms,
            uLeafHueVariation: { value: 0.18 },
            uLeafMap: { value: getLeafTexture(type as TreeType) },
        },
        side: THREE.DoubleSide,
        toneMapped: false,
    });

    return pool[key];
};

/**
 * Shadow-depth material for leaf cards: same wind sway as the leaf shader and the
 * same alpha cut-out, so leaves cast leaf-shaped shadows instead of squares.
 */
const leafDepthMaterialPool: Record<string, THREE.Material> = {};
const getTreeLeafDepthMaterial = (type: number) => {
    const key = `${type}`;
    if (leafDepthMaterialPool[key]) return leafDepthMaterialPool[key];
    leafDepthMaterialPool[key] = new (CustomShaderMaterial as any)({
        baseMaterial: THREE.MeshDepthMaterial,
        depthPacking: THREE.RGBADepthPacking,
        vertexShader: `
            uniform float uTime;
            varying vec2 vLeafUv;
            ${TREE_HIT_GLSL}
            void main() {
                vLeafUv = uv;
                float time = uTime * 1.5;
                float phase = position.x + position.z + instanceMatrix[3][0];
                vec3 pos = position;
                pos.x += sin(time + phase) * 0.1;
                pos.y += sin(time * 3.0 + phase * 2.0) * 0.05;
                float shudder = treeHitShake(clamp(position.y / 6.0, 0.0, 1.5));
                pos.x += shudder * 0.13;
                pos.z += shudder * 0.08;
                csm_Position = pos;
            }
        `,
        fragmentShader: `
            uniform sampler2D uLeafMap;
            varying vec2 vLeafUv;
            void main() {
                if (texture(uLeafMap, vLeafUv).a < 0.45) discard;
            }
        `,
        uniforms: { uTime: sharedUniforms.uTime, uTreeHitPos: sharedUniforms.uTreeHitPos, uTreeHitTime: sharedUniforms.uTreeHitTime, uLeafMap: { value: getLeafTexture(type as TreeType) } },
        side: THREE.DoubleSide,
    });
    return leafDepthMaterialPool[key];
};

const InstancedTreeBatch: React.FC<{
    type: number,
    variant: number,
    matrices: Float32Array,
    originalIndices: Int32Array,
    count: number,
    collidersEnabled: boolean;
    chunkKey: string;
    simplified?: boolean;
    lodLevel: number;
}> = ({ type, variant, matrices, originalIndices, count, collidersEnabled, chunkKey, simplified, lodLevel }) => {
    const woodMesh = useRef<THREE.InstancedMesh>(null);
    const leafMesh = useRef<THREE.InstancedMesh>(null);
    const [deferredCollidersEnabled, setDeferredCollidersEnabled] = React.useState(false);

    useEffect(() => {
        if (collidersEnabled) {
            // If we are very close (lodLevel 0), enable immediately.
            // Otherwise, defer to a later frame to avoid the LOD transition hitch.
            if (lodLevel === 0) {
                setDeferredCollidersEnabled(true);
            } else {
                const handle = requestIdleCallback(() => setDeferredCollidersEnabled(true), { timeout: 200 });
                return () => cancelIdleCallback(handle);
            }
        } else {
            setDeferredCollidersEnabled(false);
        }
    }, [collidersEnabled, lodLevel]);

    const { wood, leaves, collisionData } = useMemo(() => TreeGeometryFactory.getTreeGeometry(type, variant, simplified), [type, variant, simplified]);

    useLayoutEffect(() => {
        if (!woodMesh.current || !matrices || matrices.length === 0) return;
        woodMesh.current.instanceMatrix.array.set(matrices);
        woodMesh.current.instanceMatrix.needsUpdate = true;

        if (leafMesh.current) {
            leafMesh.current.instanceMatrix.array.set(matrices);
            leafMesh.current.instanceMatrix.needsUpdate = true;
        }
    }, [matrices, wood, leaves]);

    // Prepare Physics Instances
    const rigidBodyGroups = useMemo(() => {
        if (!collisionData || collisionData.length === 0 || !matrices || matrices.length === 0) return [];

        return collisionData.map((branchDef, branchIndex) => {
            const instances: InstancedRigidBodyProps[] = [];
            const branchMatrix = new THREE.Matrix4().compose(branchDef.position, branchDef.quaternion, branchDef.scale);
            const treeMatrix = new THREE.Matrix4();
            const tempMatrix = new THREE.Matrix4();

            for (let i = 0; i < count; i++) {
                const offset = i * 16;
                treeMatrix.fromArray(matrices, offset);
                tempMatrix.copy(treeMatrix).multiply(branchMatrix);

                const pos = new THREE.Vector3();
                const quat = new THREE.Quaternion();
                const scl = new THREE.Vector3();
                tempMatrix.decompose(pos, quat, scl);
                const euler = new THREE.Euler().setFromQuaternion(quat);

                const originalIndex = originalIndices[i];
                instances.push({
                    key: `tree-${type}-${i}-branch-${branchIndex}`,
                    position: [pos.x, pos.y, pos.z],
                    rotation: [euler.x, euler.y, euler.z],
                    scale: [scl.x, scl.y, scl.z],
                    userData: { type: 'flora_tree', chunkKey, treeIndex: originalIndex }
                });
            }
            return instances;
        });
    }, [collisionData, matrices, count, type, chunkKey, originalIndices]);

    const colors = useMemo(() => treeColors(type), [type]);

    const woodMaterial = useMemo(() => getTreeWoodMaterial(type, colors), [type, colors]);
    const leafMaterial = useMemo(() => getTreeLeafMaterial(type, colors), [type, colors]);
    const leafDepthMaterial = useMemo(() => getTreeLeafDepthMaterial(type), [type]);

    const colliderGeometries = useMemo(() => {
        const cylinder = new THREE.CylinderGeometry(0.225, 0.225, 1.0, 6);
        cylinder.translate(0, 0.5, 0);
        const box = new THREE.BoxGeometry(0.5, 1.0, 0.125);
        box.translate(0, 0.5, 0);
        return { cylinder, box };
    }, []);

    return (
        <group>
            <instancedMesh
                ref={woodMesh}
                args={[wood, woodMaterial, count]}
                castShadow
                receiveShadow
                material={woodMaterial}
            />
            {leaves.getAttribute('position') && (
                <instancedMesh
                    ref={leafMesh}
                    args={[leaves, leafMaterial, count]}
                    castShadow
                    receiveShadow
                    material={leafMaterial}
                    customDepthMaterial={leafDepthMaterial}
                />
            )}

            {deferredCollidersEnabled && rigidBodyGroups.map((instances, i) => (
                <InstancedRigidBodies
                    key={i}
                    instances={instances}
                    type="fixed"
                    colliders={type === TreeType.CACTUS ? "cuboid" : "hull"}
                >
                    <instancedMesh
                        args={[
                            type === TreeType.CACTUS ? colliderGeometries.box : colliderGeometries.cylinder,
                            undefined,
                            instances.length
                        ]}
                        visible={true}
                    >
                        <meshBasicMaterial visible={false} />
                    </instancedMesh>
                </InstancedRigidBodies>
            ))}
        </group>
    );
};
