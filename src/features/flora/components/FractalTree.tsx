import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CylinderCollider, CuboidCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';

interface FractalTreeProps {
    seed: number;
    position: THREE.Vector3;
    baseRadius?: number;
    type?: number; // 0=Oak, 1=Pine, etc.
    userData?: Record<string, any>;
    orientation?: THREE.Quaternion;
    worldPosition?: THREE.Vector3;
    worldQuaternion?: THREE.Quaternion;
    /**
     * When false, prewarms generation but does not animate growth or enable physics.
     * Useful for hiding worker latency (e.g. RootHollow CHARGING -> GROWING transition).
     */
    active?: boolean;
    /**
     * Render visibility toggle (keeps component mounted so worker/shaders can warm up).
     */
    visible?: boolean;
}

export const FractalTree: React.FC<FractalTreeProps> = ({
    seed,
    position,
    baseRadius = 0.6,
    type = 0,
    userData,
    orientation,
    worldPosition,
    worldQuaternion,
    active = true,
    visible = true
}) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const leafRef = useRef<THREE.InstancedMesh>(null);
    const lightRef = useRef<THREE.PointLight>(null);
    const [data, setData] = useState<{
        matrices: Float32Array;
        depths: Float32Array;
        leafMatrices: Float32Array;
        boundingBox: { min: THREE.Vector3, max: THREE.Vector3 };
    } | null>(null);
    const growthRef = useRef(0);
    const [physicsReady, setPhysicsReady] = useState(false);
    const physicsReadyRef = useRef(false);

    const geometry = useMemo(() => {
        const geo = new THREE.CylinderGeometry(0.2, 0.25, 1.0, 7);
        geo.translate(0, 0.5, 0); // Pivot at bottom
        return geo;
    }, []);

    const leafGeometry = useMemo(() => {
        // Different leaf shapes for different trees
        if (type === 1) return new THREE.ConeGeometry(0.3, 0.8, 5);
        return new THREE.OctahedronGeometry(0.4, 0);
    }, [type]);

    const growthSpeed = useMemo(() => {
        // RootHollow tree (type 0) keeps the original slower growth cadence
        return type === 0 ? 0.4 : 0.5;
    }, [type]);

    useEffect(() => {
        const worker = new Worker(new URL('../workers/fractal.worker.ts', import.meta.url), { type: 'module' });
        worker.postMessage({ seed, baseRadius, type });
        worker.onmessage = (e) => {
            setData(e.data);
            worker.terminate();
        };
        return () => worker.terminate();
    }, [seed, baseRadius, type]);

    useEffect(() => {
        // Reset growth/physics when activation toggles or when a new tree is generated.
        growthRef.current = 0;
        physicsReadyRef.current = false;
        setPhysicsReady(false);
    }, [seed, baseRadius, type, active]);

    useEffect(() => {
        if (!data || !meshRef.current) return;

        const { matrices, depths, leafMatrices, boundingBox } = data;
        const count = matrices.length / 16;

        meshRef.current.count = count;

        // Reapply instance transforms/attributes so the fractal structure renders correctly.
        const im = meshRef.current.instanceMatrix;
        im.array.set(matrices);
        im.needsUpdate = true;

        geometry.setAttribute('aBranchDepth', new THREE.InstancedBufferAttribute(depths, 1));

        if (leafRef.current && leafMatrices && leafMatrices.length > 0) {
            const leafCount = leafMatrices.length / 16;
            leafRef.current.count = leafCount;
            leafRef.current.instanceMatrix.array.set(leafMatrices);
            leafRef.current.instanceMatrix.needsUpdate = true;
        }

        if (boundingBox) {
            geometry.boundingBox = new THREE.Box3(
                new THREE.Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
                new THREE.Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z)
            );
            geometry.boundingSphere = new THREE.Sphere();
            geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
        }
    }, [data, geometry]);

    // Physics Generation
    // NOTE: We must clone pos/quat before passing to RigidBody, otherwise all colliders
    // share the same reference and end up at the last computed position (all bunched up).
    const physicsBodies = useMemo(() => {
        if (!physicsReady || !data) return null;

        // RootHollow flora-trees don't need per-branch colliders (expensive to create all at once).
        // Use a single coarse trunk collider to avoid a hitch at the end of the growth animation.
        if (userData?.type === 'flora_tree') {
            const { min, max } = data.boundingBox;
            const height = Math.max(max.y - min.y, 1.0);
            const halfHeight = height * 0.5;
            const radius = Math.max(baseRadius * 0.75, 0.35);
            return (
                <RigidBody type="fixed" colliders={false} userData={userData}>
                    <CylinderCollider args={[halfHeight, radius]} position={[0, halfHeight, 0]} />
                </RigidBody>
            );
        }

        const bodies: React.ReactNode[] = [];
        const { matrices, depths } = data;
        const tempMatrix = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        // IMPORTANT:
        // This component is typically placed under a parent transform (e.g. RootHollow),
        // so all physics should be authored in LOCAL space. Converting to world space here
        // would double-apply the parent and can make collisions appear "missing".

        const count = matrices.length / 16;
        for (let i = 0; i < count; i++) {
            // Only spawn physics for trunk and thick branches (depth 0, 1, 2)
            if (depths[i] > 0.4) continue;

            tempMatrix.fromArray(matrices, i * 16);
            tempMatrix.decompose(pos, quat, scale);

            // Clone vectors to avoid shared reference bug
            const finalPos = pos.clone();
            const finalQuat = quat.clone();
            const halfHeight = scale.y * 0.5;
            const radius = Math.max(scale.x, scale.z) * 0.5;

            bodies.push(
                <RigidBody
                    key={`branch-${i}`}
                    type="fixed"
                    position={finalPos}
                    quaternion={finalQuat}
                    userData={userData}
                >
                    {/* CylinderCollider args: [halfHeight, radius] */}
                    <CylinderCollider args={[halfHeight, radius]} />
                </RigidBody>
            );
        }

        // Add Leaf Colliders (Invisible)
        if (data.leafMatrices && data.leafMatrices.length > 0) {
            const leafCount = data.leafMatrices.length / 16;
            // Limit leaf colliders to avoid performance hit? 
            // For now, add them all but maybe skip some if too many.
            for (let i = 0; i < leafCount; i++) {
                tempMatrix.fromArray(data.leafMatrices, i * 16);
                tempMatrix.decompose(pos, quat, scale);

                // Clone vectors to avoid shared reference bug
                const finalPos = pos.clone();
                const finalQuat = quat.clone();

                bodies.push(
                    <RigidBody
                        key={`leaf-${i}`}
                        type="fixed"
                        position={finalPos}
                        quaternion={finalQuat}
                        userData={{ ...userData, part: 'leaf' }}
                    >
                        <CylinderCollider args={[0.4, 0.4]} />
                    </RigidBody>
                );
            }
        }

        return bodies;
    }, [physicsReady, data, userData, baseRadius]);

    const uniforms = useMemo(() => {
        let base = '#3e2723';
        let tip = '#00FFFF'; // Default magical (Cyan)

        if (type === 1) { // PINE
            base = '#3e2723'; tip = '#1B5E20';
        } else if (type === 2) { // PALM
            base = '#795548'; tip = '#8BC34A';
        } else if (type === 4) { // ACACIA
            base = '#6D4C41'; tip = '#CDDC39';
        } else if (type === 5) { // CACTUS
            base = '#2E7D32'; tip = '#43A047';
        }
        // Type 0 (Oak) is now treated as Magical/Default if not specified, 
        // OR we can add a specific check if we want Oak to be Green.
        // But since RootHollow passes nothing (type=0), and we want Magical,
        // we should let 0 be Magical OR change RootHollow to pass a special type.
        // Given the user's request, I'll make the default (0) Magical.

        return {
            uGrowthProgress: { value: 0 },
            uColorBase: { value: new THREE.Color(base) },
            uColorTip: { value: new THREE.Color(tip) },
            uNoiseTexture: { value: noiseTexture },
            uTime: { value: 0 }
        };
    }, [type]);

    useFrame((state, delta) => {
        if (!data) return;

        const t = state.clock.elapsedTime;
        if (uniforms.uTime) uniforms.uTime.value = t;

        // Prewarm mode: keep everything at "seeded but not growing".
        if (!active) {
            if (uniforms.uGrowthProgress) uniforms.uGrowthProgress.value = 0;
            if (lightRef.current) lightRef.current.intensity = 0;
            return;
        }

        // Growth is uniform-driven; avoid per-frame React state updates (reduces render hitches).
        if (growthRef.current < 1.0) {
            growthRef.current = Math.min(growthRef.current + delta * growthSpeed, 1.0);
        } else if (!physicsReadyRef.current) {
            physicsReadyRef.current = true;
            setPhysicsReady(true);
        }

        if (uniforms.uGrowthProgress) {
            uniforms.uGrowthProgress.value = growthRef.current;
        }
        if (lightRef.current) {
            lightRef.current.intensity = growthRef.current * 2.5;
        }
    });

    const topCenter = useMemo(() => {
        if (!data || !data.boundingBox) return new THREE.Vector3(0, 1.5, 0);
        const { min, max } = data.boundingBox;
        return new THREE.Vector3(
            (min.x + max.x) * 0.5,
            max.y,
            (min.z + max.z) * 0.5
        );
    }, [data]);

    const interactionBounds = useMemo(() => {
        if (!data || !data.boundingBox) return null;
        const { min, max } = data.boundingBox;
        const center = new THREE.Vector3(
            (min.x + max.x) * 0.5,
            (min.y + max.y) * 0.5,
            (min.z + max.z) * 0.5
        );
        const halfExtents = new THREE.Vector3(
            Math.max((max.x - min.x) * 0.5, 0.25),
            Math.max((max.y - min.y) * 0.5, 0.75),
            Math.max((max.z - min.z) * 0.5, 0.25)
        ).multiplyScalar(1.05); // Slightly larger to ensure leaf hits register
        return { center, halfExtents };
    }, [data]);

    if (!data) return null;

    return (
        <group position={position} visible={visible}>
            <instancedMesh
                ref={meshRef}
                args={[geometry, undefined, data.matrices.length / 16]}
                frustumCulled={true}
            >
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={`
                        attribute float aBranchDepth;
                        uniform float uGrowthProgress;
                        uniform float uTime;
                        varying float vDepth;
                        varying vec3 vPos;
                        varying vec3 vWorldNormal;

                        // Elastic out easing
                        float easeOutElastic(float x) {
                            float c4 = (2.0 * 3.14159) / 3.0;
                            return x == 0.0 ? 0.0 : x == 1.0 ? 1.0 : pow(2.0, -10.0 * x) * sin((x * 10.0 - 0.75) * c4) + 1.0;
                        }

                        void main() {
                            vDepth = aBranchDepth;
                            vPos = position;
                            vWorldNormal = normalize(mat3(modelMatrix) * normal);

                            // Growth Logic
                            float start = aBranchDepth * 0.6;
                            float end = start + 0.4;
                            float progress = smoothstep(start, end, uGrowthProgress);
                            
                            // Add bounce
                            float scale = progress;
                            if (progress > 0.0 && progress < 1.0) {
                                scale = scale + sin(progress * 3.14) * 0.1; 
                            }

                            // Wind Sway REMOVED per user request (caused disjointed segments)
                            vec3 pos = position;
                            
                            // Original wobble (kept only for growth animation, or remove if causing lag)
                            // Keeping it separate from wind.
                            float wobble = sin(uGrowthProgress * 10.0 + position.y * 2.0) * 0.03 * (1.0 - scale);
                            pos.x += wobble;
                            pos.z += wobble;

                            csm_Position = pos * scale;
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

                        // Triplanar-ish sampling for bark
                        float getNoise(vec3 p, float scale) {
                            return texture(uNoiseTexture, p * scale).r;
                        }

                        void main() {
                            // UV Mapping for Cylindrical Bark
                            // We use local cylindrical coordinates for consistency on branches
                            float angle = atan(vPos.x, vPos.z);
                            vec2 barkUV = vec2(angle * 2.0, vPos.y * 6.0); // Stretch Y for fibers
                            
                            // Sample noise
                            float nBase = texture(uNoiseTexture, vPos * 2.5).r; // 3D lookup
                            float nBark = texture(uNoiseTexture, vec3(barkUV.x, barkUV.y, 0.0) * 0.5).r; // Cylindrical lookup approximation
                            
                            // Create ridges
                            float ridges = smoothstep(0.3, 0.7, nBark);
                            float crevices = 1.0 - ridges;

                            // Color mixing
                            vec3 col = mix(uColorBase, uColorTip, pow(vDepth, 3.0));
                            
                            // Darken crevices
                            col *= mix(1.0, 0.5, crevices * 0.8);
                            
                            // Add "Moss" (noise on top surfaces)
                            float mossNoise = texture(uNoiseTexture, vPos * 4.0 + vec3(5.0)).g;
                            float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                            if (upFactor > 0.2 && mossNoise > 0.5) {
                                col = mix(col, vec3(0.1, 0.5, 0.1), (mossNoise - 0.5) * 2.0 * upFactor);
                            }

                            csm_DiffuseColor = vec4(col, 1.0);

                            // Normals: Perturb based on ridges
                            // (Simplified: we use NormalMap logic in StandardMaterial if we had one, 
                            // here we can adjust roughness)
                            
                            // Roughness: Crevices are rougher, ridges smoother or vice versa
                            float rough = 0.8 + crevices * 0.2;
                            csm_Roughness = rough;

                            // Emissive for tips (Magical)
                            if (vDepth > 0.8) {
                                csm_Emissive = uColorTip * 0.5 * ridges;
                            }
                        }
                    `}
                    uniforms={uniforms}
                    roughness={0.9} // Base roughness
                    toneMapped={false}
                />
            </instancedMesh>
            <instancedMesh
                ref={leafRef}
                args={[leafGeometry, undefined, data.leafMatrices ? data.leafMatrices.length / 16 : 0]}
                frustumCulled={true}
            >
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={`
                        uniform float uGrowthProgress;
                        uniform float uTime;
                        varying vec3 vPos;
                        varying vec3 vWorldNormal;

                        void main() {
                            vPos = position;
                            vWorldNormal = normalize(mat3(modelMatrix) * normal);

                            // Leaves appear at the end
                            float start = 0.8;
                            float end = 1.0;
                            float scale = smoothstep(start, end, uGrowthProgress);
                            
                            // Pop effect
                            float pop = sin(scale * 3.14 * 2.0) * 0.2;
                            scale += pop;

                            // Gentle Sway
                            float sway = sin(uTime * 2.0 + position.x * 5.0 + position.z * 5.0) * 0.1;
                            vec3 pos = position;
                            pos.x += sway * scale;
                            pos.y += sway * 0.5 * scale;

                            csm_Position = pos * scale;
                        }
                    `}
                    fragmentShader={`
                        precision highp sampler3D;
                        varying vec3 vPos;
                        varying vec3 vWorldNormal;
                        uniform vec3 uColorTip;
                        uniform sampler3D uNoiseTexture;
                        uniform float uTime;

                        void main() {
                            // Static Color Variation (using noise)
                            // We need to use uNoiseTexture here which is available in uniforms
                            float variation = texture(uNoiseTexture, vPos * 0.5).r;

                            // Simple Gradient
                            float tip = smoothstep(0.0, 0.5, vPos.y); 
                            
                            vec3 col = uColorTip;
                            col = mix(col * 0.85, col * 1.15, variation);
                            col = mix(col, col * 1.4, tip); 
                            
                            csm_DiffuseColor = vec4(col, 1.0);
                            // Restore original leaf self-illumination (see history: csm_Emissive = uColorTip * 2.0)
                            csm_Emissive = uColorTip * 2.0;
                            csm_Roughness = 0.6;
                        }
                    `}
                    uniforms={uniforms}
                    toneMapped={false}
                />
            </instancedMesh>
            {userData?.type === 'flora_tree' && interactionBounds && (
                <RigidBody
                    type="fixed"
                    colliders={false}
                    position={interactionBounds.center}
                    userData={userData}
                >
                    {/* Sensor collider so DIG rays hitting leaves/canopy still grant the axe */}
                    <CuboidCollider
                        args={[
                            interactionBounds.halfExtents.x,
                            interactionBounds.halfExtents.y,
                            interactionBounds.halfExtents.z
                        ]}
                        sensor
                    />
                </RigidBody>
            )}
            <pointLight
                ref={lightRef}
                color="#E0F7FA"
                intensity={0}
                distance={8}
                decay={2}
                position={topCenter}
                castShadow={false}
            />
            {physicsBodies}
        </group>
    );
};
