import React, { useEffect, useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';

interface FractalTreeProps {
    seed: number;
    position: THREE.Vector3;
    baseRadius?: number;
    type?: number; // 0=Oak, 1=Pine, etc.
    userData?: Record<string, any>;
}

export const FractalTree: React.FC<FractalTreeProps> = ({ seed, position, baseRadius = 0.6, type = 0, userData }) => {
    // ... (refs and state)

    // ... (geometry memo)

    // ... (worker effect)

    // ... (data effect)

    // ... (useFrame)

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
        for (let i = 0; i < count; i++) {
            // Only spawn physics for trunk and thick branches (depth 0, 1, 2)
            if (depths[i] > 0.4) continue;

            tempMatrix.fromArray(matrices, i * 16);
            tempMatrix.decompose(pos, quat, scale);

            bodies.push(
                <RigidBody
                    key={i}
                    type="fixed"
                    position={pos} // Local to group
                    quaternion={quat}
                    userData={userData}
                >
                    {/* CylinderCollider args: [halfHeight, radius] */}
                    <CylinderCollider args={[scale.y * 0.5, Math.max(scale.x, scale.z) * 0.5]} />
                </RigidBody>
            );
        }
        return bodies;
    }, [physicsReady, data, userData]);

    const uniforms = useMemo(() => {
        let base = '#3e2723';
        let tip = '#00FFFF'; // Default magical

        if (type === 0) { // OAK
            base = '#4e342e'; tip = '#4CAF50';
        } else if (type === 1) { // PINE
            base = '#3e2723'; tip = '#1B5E20';
        } else if (type === 2) { // PALM
            base = '#795548'; tip = '#8BC34A';
        } else if (type === 4) { // ACACIA
            base = '#6D4C41'; tip = '#CDDC39';
        } else if (type === 5) { // CACTUS
            base = '#2E7D32'; tip = '#43A047';
        }

        return {
            uGrowthProgress: { value: 0 },
            uColorBase: { value: new THREE.Color(base) },
            uColorTip: { value: new THREE.Color(tip) }
        };
    }, [type]);

    const topCenter = useMemo(() => {
        if (!data || !data.boundingBox) return new THREE.Vector3(0, 1.5, 0);
        const { min, max } = data.boundingBox;
        return new THREE.Vector3(
            (min.x + max.x) * 0.5,
            max.y,
            (min.z + max.z) * 0.5
        );
    }, [data]);

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

                        // Elastic out easing
                        float easeOutElastic(float x) {
                            float c4 = (2.0 * 3.14159) / 3.0;
                            return x == 0.0 ? 0.0 : x == 1.0 ? 1.0 : pow(2.0, -10.0 * x) * sin((x * 10.0 - 0.75) * c4) + 1.0;
                        }

                        void main() {
                            vDepth = aBranchDepth;

                            // Growth Logic
                            float start = aBranchDepth * 0.6;
                            float end = start + 0.4;
                            float progress = smoothstep(start, end, uGrowthProgress);
                            
                            // Add bounce
                            float scale = progress;
                            if (progress > 0.0 && progress < 1.0) {
                                scale = scale + sin(progress * 3.14) * 0.1; 
                            }

                            // Small wobble for organic feel
                            float wobble = sin(uGrowthProgress * 10.0 + position.y * 2.0) * 0.03 * (1.0 - scale);
                            vec3 pos = position;
                            pos.x += wobble;
                            pos.z += wobble;

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
            <instancedMesh
                ref={leafRef}
                args={[leafGeometry, undefined, data.leafMatrices ? data.leafMatrices.length / 16 : 0]}
                frustumCulled={true}
            >
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={`
                        uniform float uGrowthProgress;
                        varying vec3 vPos;

                        void main() {
                            vPos = position;
                            // Leaves appear at the end
                            float start = 0.8;
                            float end = 1.0;
                            float scale = smoothstep(start, end, uGrowthProgress);
                            
                            // Pop effect
                            float pop = sin(scale * 3.14 * 2.0) * 0.2;
                            scale += pop;

                            csm_Position = position * scale;
                        }
                    `}
                    fragmentShader={`
                        uniform vec3 uColorTip;
                        void main() {
                            csm_DiffuseColor = vec4(uColorTip, 1.0);
                            csm_Emissive = uColorTip * 2.0;
                        }
                    `}
                    uniforms={uniforms}
                    toneMapped={false}
                />
            </instancedMesh>
            <pointLight
                color="#E0F7FA"
                intensity={growth * 2.5}
                distance={8}
                decay={2}
                position={topCenter}
                castShadow={false}
            />
            {physicsBodies}
        </group>
    );
};
