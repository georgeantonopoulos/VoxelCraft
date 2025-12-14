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
        uIsInstanced: { value: 1.0 }
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
                        uniform float uTime;
                        varying float vDepth;
                        varying vec3 vPos;
                        varying vec3 vWorldNormal;

                        void main() {
                            vDepth = aBranchDepth;
                            vPos = position;
                            vWorldNormal = normalize(mat3(modelMatrix) * normal);
                            
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
                        
                        uniform vec3 uColorBase;
                        uniform vec3 uColorTip;
                        uniform sampler3D uNoiseTexture;

                        void main() {
                            // UV Mapping for Cylindrical Bark
                            float angle = atan(vPos.x, vPos.z);
                            vec2 barkUV = vec2(angle * 2.0, vPos.y * 6.0); 
                            
                            // Sample noise
                            float nBase = texture(uNoiseTexture, vPos * 2.5).r; 
                            float nBark = texture(uNoiseTexture, vec3(barkUV.x, barkUV.y, 0.0) * 0.5).r; 
                            
                            // Create ridges
                            float ridges = smoothstep(0.3, 0.7, nBark);
                            float crevices = 1.0 - ridges;

                            // Color mixing
                            vec3 col = mix(uColorBase, uColorTip, pow(vDepth, 3.0)); // Bias towards base color for trunk
                            
                            // Darken crevices
                            col *= mix(1.0, 0.5, crevices * 0.8);
                            
                            // Add "Moss"
                            float mossNoise = texture(uNoiseTexture, vPos * 4.0 + vec3(5.0)).g;
                            float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                            if (upFactor > 0.2 && mossNoise > 0.5) {
                                col = mix(col, vec3(0.1, 0.5, 0.1), (mossNoise - 0.5) * 2.0 * upFactor);
                            }

                            csm_DiffuseColor = vec4(col, 1.0);
                            
                            float rough = 0.8 + crevices * 0.2;
                            csm_Roughness = rough;

                            // Emissive for tips
                            if (vDepth > 0.8) {
                                csm_Emissive = uColorTip * 0.5 * ridges;
                            }
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
                        varying vec3 vPos;
                        varying vec3 vWorldNormal;

                        void main() {
                            vPos = position;
                            vWorldNormal = normalize(mat3(modelMatrix) * normal);
                            
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
                        uniform vec3 uColorTip;
                        uniform sampler3D uNoiseTexture;
                        uniform float uTime;

                        void main() {
                            float n = texture(uNoiseTexture, vPos * 1.5).r;
                            
                            // Veins
                            float veins = abs(n * 2.0 - 1.0);
                            veins = pow(veins, 3.0); 
                            
                            // Color variation
                            vec3 col = uColorTip;
                            col = mix(col, col * 0.5, veins * 0.5); 
                            
                            // Tip gradient
                            // Approximate leaf tip using local Y or distance from center?
                            // Leaves are usually small clumps. vPos is local to CLUMP (if instantiated) or TREE?
                            // In TreeGeometryFactory, leaves are merged into tree. vPos is relative to TREE origin.
                            // So we can't easily detect "tip of leaf" without extra attributes.
                            // But we can use noise for variety.
                            
                            // Magical pulse
                            // Use noise for pulse phase to avoid "sliding" stripes across the tree
                            float pulseNoise = texture(uNoiseTexture, vPos * 0.5).r;
                            // Throb based on time + large noise structure
                            float pulse = sin(uTime * 2.0 + pulseNoise * 6.28) * 0.5 + 0.5;
                            
                            vec3 emissive = uColorTip * (0.3 + 0.7 * pulse) * (1.0 - veins);

                            csm_DiffuseColor = vec4(col, 1.0);
                            csm_Emissive = emissive * 1.2; 
                            csm_Roughness = 0.4 + veins * 0.6;
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
