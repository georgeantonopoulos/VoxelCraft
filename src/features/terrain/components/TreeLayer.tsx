import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { InstancedRigidBodies, InstancedRigidBodyProps } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';

interface TreeLayerProps {
    data: Float32Array; // Stride 4: x, y, z, type
}

export const TreeLayer: React.FC<TreeLayerProps> = React.memo(({ data }) => {
    // Group data by type (+ jungle variant)
    const batches = useMemo(() => {
        const map = new Map<string, { type: number, variant: number, positions: number[], count: number }>();
        const JUNGLE_VARIANTS = 4; // Small set of deterministic templates for instancing

        for (let i = 0; i < data.length; i += 4) {
            const x = data[i];
            const y = data[i + 1];
            const z = data[i + 2];
            const type = data[i + 3];

            // Deterministic variant selection for jungle trees so nearby trees
            // share a few templates while still looking varied.
            let variant = 0;
            if (type === TreeType.JUNGLE) {
                const seed = x * 12.9898 + z * 78.233;
                const h = Math.abs(Math.sin(seed)) * 43758.5453;
                variant = Math.floor((h % 1) * JUNGLE_VARIANTS);
            }

            const key = `${type}:${variant}`;
            if (!map.has(key)) {
                map.set(key, { type, variant, positions: [], count: 0 });
            }
            const batch = map.get(key)!;
            batch.positions.push(x, y, z);
            batch.count++;
        }
        return map;
    }, [data]);

    return (
        <group>
            {Array.from(batches.values()).map((batch) => (
                <InstancedTreeBatch
                    key={`${batch.type}:${batch.variant}`}
                    type={batch.type}
                    variant={batch.variant}
                    positions={batch.positions}
                    count={batch.count}
                />
            ))}
        </group>
    );
});

const InstancedTreeBatch: React.FC<{ type: number, variant: number, positions: number[], count: number }> = ({ type, variant, positions, count }) => {
    const woodMesh = useRef<THREE.InstancedMesh>(null);
    const leafMesh = useRef<THREE.InstancedMesh>(null);
    const woodMaterialRef = useRef<any>(null);
    const leafMaterialRef = useRef<any>(null);

    const { wood, leaves, collisionData } = useMemo(() => TreeGeometryFactory.getTreeGeometry(type, variant), [type, variant]);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useLayoutEffect(() => {
        if (!woodMesh.current) return;

        for (let i = 0; i < count; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            dummy.position.set(x, y, z);

            // Random rotation
            const seed = x * 12.9898 + z * 78.233;
            dummy.rotation.y = (seed % 1) * Math.PI * 2;

            // Random scale variation
            const scale = 0.8 + (seed % 0.4);
            dummy.scale.setScalar(scale);

            dummy.updateMatrix();
            woodMesh.current.setMatrixAt(i, dummy.matrix);
            if (leafMesh.current) leafMesh.current.setMatrixAt(i, dummy.matrix);
        }

        woodMesh.current.instanceMatrix.needsUpdate = true;
        if (leafMesh.current) leafMesh.current.instanceMatrix.needsUpdate = true;
    }, [positions, count]);

    // NOTE:
    // Chunk opacity fade was removed because the transparent render path can introduce
    // noticeable hitches while streaming. Trees remain fully opaque; fog hides pop-in.

    // Prepare Physics Instances
    const rigidBodyGroups = useMemo(() => {
        if (!collisionData || collisionData.length === 0) return [];

        return collisionData.map((branchDef, branchIndex) => {
            const instances: InstancedRigidBodyProps[] = [];
            const branchMatrix = new THREE.Matrix4().compose(branchDef.position, branchDef.quaternion, branchDef.scale);
            const tempMatrix = new THREE.Matrix4();
            const tempDummy = new THREE.Object3D();

            for (let i = 0; i < count; i++) {
                const x = positions[i * 3];
                const y = positions[i * 3 + 1];
                const z = positions[i * 3 + 2];

                // Reconstruct Tree Transform (must match visual)
                tempDummy.position.set(x, y, z);
                const seed = x * 12.9898 + z * 78.233;
                tempDummy.rotation.y = (seed % 1) * Math.PI * 2;
                tempDummy.rotation.x = 0; tempDummy.rotation.z = 0;
                const scale = 0.8 + (seed % 0.4);
                tempDummy.scale.setScalar(scale);
                tempDummy.updateMatrix();

                // Combine: Tree * Branch
                tempMatrix.copy(tempDummy.matrix).multiply(branchMatrix);

                const pos = new THREE.Vector3();
                const quat = new THREE.Quaternion();
                const scl = new THREE.Vector3();
                tempMatrix.decompose(pos, quat, scl);

                const euler = new THREE.Euler().setFromQuaternion(quat);

                instances.push({
                    key: `tree-${type}-${i}-branch-${branchIndex}`,
                    position: [pos.x, pos.y, pos.z],
                    rotation: [euler.x, euler.y, euler.z],
                    scale: [scl.x, scl.y, scl.z],
                    userData: { type: 'flora_tree' }
                });
            }
            return instances;
        });
    }, [collisionData, positions, count, type]);

    // Colors
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

    const uniforms = useMemo(() => ({
        uColorBase: { value: new THREE.Color(colors.base) },
        uColorTip: { value: new THREE.Color(colors.tip) },
        uNoiseTexture: { value: noiseTexture },
        uTime: { value: 0 },
        // Distinguish main world trees from others if needed
        uIsInstanced: { value: 1.0 },
        // Per-tree hue shift for visible color variety (0.30 ≈ 17 degrees).
        uLeafHueVariation: { value: 0.30 }
    }), [colors]);

    useFrame((state) => {
        if (woodMaterialRef.current) woodMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
        if (leafMaterialRef.current) leafMaterialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    });

    // Collider Geometries
    const colliderGeometries = useMemo(() => {
        const cylinder = new THREE.CylinderGeometry(0.225, 0.225, 1.0, 6);
        cylinder.translate(0, 0.5, 0);

        const box = new THREE.BoxGeometry(0.5, 1.0, 0.125);
        box.translate(0, 0.5, 0);

        return { cylinder, box };
    }, []);

    return (
        <group>
            <instancedMesh ref={woodMesh} args={[wood, undefined, count]} castShadow receiveShadow>
                <CustomShaderMaterial
                    ref={woodMaterialRef}
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={`
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
                            // Include instance transform so moss/lighting doesn't "ignore" per-tree rotation.
                            vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
                            vBranchAxis = aBranchAxis;
                            vBranchOrigin = aBranchOrigin;
                            
                            // Wind Sway
                            float windStrength = 0.05 * pow(1.0 - aBranchDepth, 2.0); // More sway at tips (lower depth logic might be inverted? No, depth 0 is root)
                            // Wait, depth 0 is root, depth MAX is tips. 
                            // In Factory: normalizedDepth = seg.depth / MAX_DEPTH. So 0=Root, 1=Tip.
                            // So sway should be proportional to aBranchDepth.
                            
                            windStrength = 0.08 * pow(aBranchDepth, 2.0);

                            float time = uTime * 1.5;
                            // Add some position variation to phase
                            float phase = position.x + position.z; 
                            float sway = sin(time + phase) * windStrength + sin(time * 0.5 + phase * 0.5) * windStrength * 0.5;
                            
                            vec3 pos = position;
                            pos.x += sway;
                            pos.z += sway * 0.5;

                            csm_Position = pos;
                        }
                    `}
                    fragmentShader={`
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
                            // Cylindrical bark mapping around the true branch axis (per-segment),
                            // so rotated end-branches don't get "wrong axis" artifacts.
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
                            
                            // Sample noise
                            float nBase = texture(uNoiseTexture, vPos * 0.35 + vec3(7.0)).r;
                            vec3 barkP = vec3(cos(angle), sin(angle), along * 1.5);
                            float nBark = texture(uNoiseTexture, barkP * 0.8).r;
                            
                            // Create ridges
                            float ridges = smoothstep(0.3, 0.7, nBark);
                            float crevices = 1.0 - ridges;

                            // Keep branches brown (no "green tip" tinting on wood).
                            vec3 col = uColorBase;
                            col *= mix(0.92, 1.05, nBase * 0.6);
                            
                            // Darken crevices
                            col *= mix(1.0, 0.5, crevices * 0.8);
                            
                            // Add "Moss"
                            float mossNoise = texture(uNoiseTexture, vPos * 0.55 + vec3(5.0)).g;
                            float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                            if (upFactor > 0.2 && mossNoise > 0.5) {
                                col = mix(col, vec3(0.1, 0.5, 0.1), (mossNoise - 0.5) * 2.0 * upFactor);
                            }

                            csm_DiffuseColor = vec4(col, 1.0);
                            
                            float rough = 0.8 + crevices * 0.2;
                            csm_Roughness = rough;
                        }
                    `}
                    uniforms={uniforms}
                    roughness={0.9}
                    toneMapped={false}
                />
            </instancedMesh>
            {leaves.getAttribute('position') && (
                <instancedMesh ref={leafMesh} args={[leaves, undefined, count]} castShadow receiveShadow>
                    <CustomShaderMaterial
                        ref={leafMaterialRef}
                        baseMaterial={THREE.MeshStandardMaterial}
                        vertexShader={`
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
                            
                            // Per-tree seed for color variation
                            vTreeSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453123);
                            
                            // IMPORTANT: Offset noise coords by tree seed so each tree samples from
                            // a different part of the noise texture, not just based on world position.
                            // This prevents nearby trees from having nearly identical colors.
                            vec3 treeNoiseOffset = vec3(vTreeSeed * 50.0, vTreeSeed * 37.0, vTreeSeed * 23.0);
                            vNoisePos = position + treeNoiseOffset;
                            
                            vLeafRand = aLeafRand;

                            // Per-leaf hue jitter (computed per-vertex to keep fragment cost low).
                            float hueN = hash11(aLeafRand * 113.1 + vTreeSeed * 19.7);
                            float hueAngle = (hueN * 2.0 - 1.0) * uLeafHueVariation;
                            vHueCos = cos(hueAngle);
                            vHueSin = sin(hueAngle);
                            
                            // Global wind sway for leaves (match tree sway roughly)
                            // Leaves are generally at top, so assume high sway
                            float swayStrength = 0.1;
                            float time = uTime * 1.5;
                            float phase = position.x + position.z + instanceMatrix[3][0]; // Add instance pos for phase variation

                            float sway = sin(time + phase) * swayStrength;
                            vec3 pos = position;
                            pos.x += sway; 
                            
                            // Leaf wobble
                            float wobble = sin(time * 3.0 + phase * 2.0) * 0.05;
                            pos.y += wobble;

                            csm_Position = pos;
                        }
                    `}
                        fragmentShader={`
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
                            vec3 k = vec3(0.57735026919); // normalize(vec3(1.0))
                            return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
                        }

                        void main() {
                            // Per-tree brightness/saturation variation (deterministic per tree)
                            float treeBrightness = 0.85 + vTreeSeed * 0.30; // 0.85 to 1.15
                            float treeSaturation = 0.70 + fract(vTreeSeed * 7.3) * 0.20; // 0.70 to 0.90 (reduced saturation)
                            
                            // Static Color Variation (using noise offset by tree seed)
                            float variation = texture(uNoiseTexture, vNoisePos * 0.15).r;
                            float micro = texture(uNoiseTexture, vNoisePos * 0.4 + vPos * 0.5 + vec3(11.0)).r;
                            
                            // Simple Gradient based on local Y
                            float tip = smoothstep(0.0, 1.0, vPos.y + 0.5); 
                            
                            // Base leaf color with wider tint variation
                            vec3 baseLeaf = uColorTip * 0.80 * treeBrightness;
                            vec3 tintA = baseLeaf * vec3(0.70, 0.95, 0.75); // More red/blue reduction for variety
                            vec3 tintB = baseLeaf * vec3(1.0, 1.10, 0.95);  // Brighter yellower green
                            vec3 col = mix(tintA, tintB, variation);
                            col *= mix(0.88, 1.12, micro);
                            col *= mix(0.90, 1.08, tip);
                            
                            // Apply saturation adjustment
                            float lum = dot(col, vec3(0.299, 0.587, 0.114));
                            col = mix(vec3(lum), col, treeSaturation);

                            col = clamp(hueRotateCS(col, vHueCos, vHueSin), 0.0, 1.0);

                            csm_DiffuseColor = vec4(col, 1.0);
                            // Static Emissive (no pulse) - reduced glow
                            csm_Emissive = uColorTip * 0.05; 
                            csm_Roughness = 0.6;
                        }
                    `}
                        uniforms={uniforms}
                        toneMapped={false}
                    />
                </instancedMesh>
            )}

            {/* Physics Colliders */}
            {rigidBodyGroups.map((instances, i) => (
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
