import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies, InstancedRigidBodyProps } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';
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
}

export const TreeLayer: React.FC<TreeLayerProps> = React.memo(({ data, treeInstanceBatches, collidersEnabled, chunkKey, simplified }) => {
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
                />
            ))}
        </group>
    );
});

// Material pools for trees to avoid per-chunk creation.
const treeWoodMaterialPool: Record<string, THREE.Material> = {};
const treeLeafMaterialPool: Record<string, THREE.Material> = {};
const treeLeafOpaqueMaterialPool: Record<string, THREE.Material> = {};

const getTreeWoodMaterial = (type: number, colors: any) => {
    const key = `${type}`;
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
                float angle = atan(x, z);
                
                float nBase = texture(uNoiseTexture, vPos * 0.35 + vec3(7.0)).r;
                vec3 barkP = vec3(cos(angle), sin(angle), along * 1.5);
                float nBark = texture(uNoiseTexture, barkP * 0.8).r;
                
                float ridges = smoothstep(0.3, 0.7, nBark);
                float crevices = 1.0 - ridges;

                vec3 col = uColorBase;
                col *= mix(0.92, 1.05, nBase * 0.6);
                col *= mix(1.0, 0.5, crevices * 0.8);
                
                float mossNoise = texture(uNoiseTexture, vPos * 0.55 + vec3(5.0)).g;
                float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                if (upFactor > 0.2 && mossNoise > 0.5) {
                    col = mix(col, vec3(0.1, 0.5, 0.1), (mossNoise - 0.5) * 2.0 * upFactor);
                }

                csm_DiffuseColor = vec4(col, 1.0);
                csm_Roughness = 0.8 + crevices * 0.2;
            }
        `,
        uniforms: {
            uColorBase: { value: new THREE.Color(colors.base) },
            uColorTip: { value: new THREE.Color(colors.tip) },
            uNoiseTexture: { value: getNoiseTexture() },
            ...sharedUniforms,
            uIsInstanced: { value: 1.0 },
        },
        roughness: 0.9,
        toneMapped: false,
    });

    return treeWoodMaterialPool[key];
};

const getTreeLeafMaterial = (type: number, colors: any, opaque = false) => {
    const key = `${type}${opaque ? ':opaque' : ''}`;
    const pool = opaque ? treeLeafOpaqueMaterialPool : treeLeafMaterialPool;
    if (pool[key]) return pool[key];

    pool[key] = new (CustomShaderMaterial as any)({
        baseMaterial: THREE.MeshStandardMaterial,
        transparent: !opaque,
        alphaTest: opaque ? 0.5 : 0.0,
        vertexShader: `
            uniform float uTime;
            uniform float uLeafHueVariation;
            attribute float aLeafRand;
            varying vec3 vPos;
            varying vec3 vWorldNormal;
            varying vec3 vNoisePos;
            varying float vLeafRand;
            varying float vTreeSeed;
            varying float vHueCos;
            varying float vHueSin;

            float hash11(float p) {
                return fract(sin(p) * 43758.5453123);
            }

            void main() {
                vPos = position;
                vWorldNormal = normalize(mat3(modelMatrix) * normal);
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
            uniform vec3 uColorTip;
            uniform sampler3D uNoiseTexture;
            uniform float uTime;

            vec3 hueRotateCS(vec3 color, float c, float s) {
                vec3 k = vec3(0.57735026919);
                return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
            }

            void main() {
                float treeBrightness = 0.85 + vTreeSeed * 0.30;
                float treeSaturation = 0.70 + fract(vTreeSeed * 7.3) * 0.20;
                float variation = texture(uNoiseTexture, vNoisePos * 0.15).r;
                float micro = texture(uNoiseTexture, vNoisePos * 0.4 + vPos * 0.5 + vec3(11.0)).r;
                float tip = smoothstep(0.0, 1.0, vPos.y + 0.5); 
                
                vec3 baseLeaf = uColorTip * 0.80 * treeBrightness;
                vec3 tintA = baseLeaf * vec3(0.70, 0.95, 0.75);
                vec3 tintB = baseLeaf * vec3(1.0, 1.10, 0.95);
                vec3 col = mix(tintA, tintB, variation);
                col *= mix(0.88, 1.12, micro);
                col *= mix(0.90, 1.08, tip);
                
                float lum = dot(col, vec3(0.299, 0.587, 0.114));
                col = mix(vec3(lum), col, treeSaturation);
                col = clamp(hueRotateCS(col, vHueCos, vHueSin), 0.0, 1.0);

                csm_DiffuseColor = vec4(col, 1.0);
                csm_Emissive = uColorTip * 0.05; 
                csm_Roughness = 0.6;
            }
        `,
        uniforms: {
            uColorTip: { value: new THREE.Color(colors.tip) },
            uNoiseTexture: { value: getNoiseTexture() },
            ...sharedUniforms,
            uLeafHueVariation: { value: 0.30 }
        },
        toneMapped: false,
    });

    return treeLeafMaterialPool[key];
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
}> = ({ type, variant, matrices, originalIndices, count, collidersEnabled, chunkKey, simplified }) => {
    const woodMesh = useRef<THREE.InstancedMesh>(null);
    const leafMesh = useRef<THREE.InstancedMesh>(null);

    const { wood, leaves, collisionData } = useMemo(() => TreeGeometryFactory.getTreeGeometry(type, variant, simplified), [type, variant, simplified]);

    useLayoutEffect(() => {
        if (!woodMesh.current || !matrices || matrices.length === 0) return;
        woodMesh.current.instanceMatrix.array.set(matrices);
        woodMesh.current.instanceMatrix.needsUpdate = true;

        if (leafMesh.current) {
            leafMesh.current.instanceMatrix.array.set(matrices);
            leafMesh.current.instanceMatrix.needsUpdate = true;
        }
    }, [matrices]);

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

    const colors = useMemo(() => {
        let base = '#3e2723';
        let tip = '#00FFFF';

        if (type === TreeType.OAK) { base = '#4e342e'; tip = '#4CAF50'; }
        else if (type === TreeType.PINE) { base = '#3e2723'; tip = '#1B5E20'; }
        else if (type === TreeType.PALM) { base = '#795548'; tip = '#8BC34A'; }
        else if (type === TreeType.ACACIA) { base = '#6D4C41'; tip = '#CDDC39'; }
        else if (type === TreeType.CACTUS) { base = '#2E7D32'; tip = '#43A047'; }
        else if (type === TreeType.JUNGLE) { base = '#5D4037'; tip = '#2E7D32'; }

        return { base, tip };
    }, [type]);

    const woodMaterial = useMemo(() => getTreeWoodMaterial(type, colors), [type, colors]);
    const leafMaterial = useMemo(() => getTreeLeafMaterial(type, colors, simplified), [type, colors, simplified]);

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
                />
            )}

            {collidersEnabled && rigidBodyGroups.map((instances, i) => (
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
