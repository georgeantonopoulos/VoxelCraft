import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';

interface FractalTreeProps {
    seed: number;
    position: THREE.Vector3;
}

export const FractalTree: React.FC<FractalTreeProps> = ({ seed, position }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const [data, setData] = useState<{ matrices: Float32Array, depths: Float32Array, boundingBox: { min: any, max: any } } | null>(null);
    const [growth, setGrowth] = useState(0);
    const [physicsReady, setPhysicsReady] = useState(false);

    // Geometry with pivot at bottom
    const geometry = useMemo(() => {
        const geo = new THREE.CylinderGeometry(0.2, 0.25, 1.0, 7);
        geo.translate(0, 0.5, 0); // Pivot at bottom
        return geo;
    }, []);

    useEffect(() => {
        const worker = new Worker(new URL('../workers/fractal.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
            setData(e.data);
        };
        worker.postMessage({ seed });
        return () => worker.terminate();
    }, [seed]);

    // Apply bounding box and attributes when data arrives
    useEffect(() => {
        if (data && meshRef.current) {
            const { matrices, depths, boundingBox } = data;
            const count = matrices.length / 16;

            meshRef.current.count = count;

            // Set instance matrices
            const im = meshRef.current.instanceMatrix;
            im.array.set(matrices);
            im.needsUpdate = true;

            // Set attributes
            geometry.setAttribute('aBranchDepth', new THREE.InstancedBufferAttribute(depths, 1));

            // Set Bounding Box
            if (boundingBox) {
                geometry.boundingBox = new THREE.Box3(
                    new THREE.Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
                    new THREE.Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z)
                );
                geometry.boundingSphere = new THREE.Sphere();
                geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
            }
        }
    }, [data, geometry]);

    useFrame((state, delta) => {
        if (!data) return;

        // Animate Growth
        if (growth < 1.0) {
            setGrowth(g => Math.min(g + delta * 0.4, 1.0)); // Grow over ~2.5 seconds
        } else if (!physicsReady) {
            setPhysicsReady(true);
        }

        // Update Uniforms
        if (meshRef.current && meshRef.current.material) {
             // @ts-ignore
             const mat = meshRef.current.material;
             if (mat.uniforms && mat.uniforms.uGrowthProgress) {
                 mat.uniforms.uGrowthProgress.value = growth;
             }
        }
    });

    // Physics Generation
    const physicsBodies = useMemo(() => {
        if (!physicsReady || !data) return null;

        const bodies = [];
        const { matrices, depths } = data;
        const tempMatrix = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        const count = matrices.length / 16;
        for(let i=0; i<count; i++) {
             // Only spawn physics for trunk and thick branches
             if (depths[i] > 0.35) continue;

             tempMatrix.fromArray(matrices, i * 16);
             tempMatrix.decompose(pos, quat, scale);

             bodies.push(
                 <RigidBody
                    key={i}
                    type="fixed"
                    position={pos} // Local to group
                    quaternion={quat}
                 >
                    {/* CylinderCollider args: [halfHeight, radius] */}
                    <CylinderCollider args={[scale.y * 0.5, Math.max(scale.x, scale.z) * 0.5]} />
                 </RigidBody>
             );
        }
        return bodies;
    }, [physicsReady, data]);

    const uniforms = useMemo(() => ({
        uGrowthProgress: { value: 0 },
        uColorBase: { value: new THREE.Color('#3e2723') }, // Dark Wood
        uColorTip: { value: new THREE.Color('#00FFFF') } // Cyan Glow
    }), []);

    if (!data) return null;

    return (
        <group position={position}>
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
                        varying float vDepth;

                        void main() {
                            vDepth = aBranchDepth;

                            // Growth Logic
                            float start = aBranchDepth * 0.6;
                            float end = start + 0.4;
                            float scale = smoothstep(start, end, uGrowthProgress);

                            // Small wobble for organic feel
                            float wobble = sin(uGrowthProgress * 15.0 + position.y) * 0.05 * (1.0 - scale);
                            vec3 pos = position;
                            pos.x += wobble;

                            csm_Position = pos * scale;
                        }
                    `}
                    fragmentShader={`
                        varying float vDepth;
                        uniform vec3 uColorBase;
                        uniform vec3 uColorTip;

                        void main() {
                            vec3 col = mix(uColorBase, uColorTip, pow(vDepth, 3.0));
                            csm_DiffuseColor = vec4(col, 1.0);

                            // Emissive for tips
                            if (vDepth > 0.8) {
                                csm_Emissive = uColorTip * 0.8;
                            }
                        }
                    `}
                    uniforms={uniforms}
                    roughness={0.8}
                    toneMapped={false}
                />
            </instancedMesh>
            {physicsBodies}
        </group>
    );
};
