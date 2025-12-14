import React, { useMemo } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

interface FallingTreeProps {
    position: THREE.Vector3;
    type: number;
    seed: number; // We pass the seed derived from position to match the static tree
}

export const FallingTree: React.FC<FallingTreeProps> = ({ position, type, seed }) => {
    const { wood, leaves } = useMemo(() => TreeGeometryFactory.getTreeGeometry(type), [type]);

    const { rotation, scale } = useMemo(() => {
        const r = (seed % 1) * Math.PI * 2;
        const s = 0.8 + (seed % 0.4);
        return { rotation: r, scale: s };
    }, [seed]);

    const colors = useMemo(() => {
        let base = '#3e2723';
        let tip = '#00FFFF';

        if (type === TreeType.OAK) { base = '#4e342e'; tip = '#4CAF50'; }
        else if (type === TreeType.PINE) { base = '#3e2723'; tip = '#1B5E20'; }
        else if (type === TreeType.PALM) { base = '#795548'; tip = '#8BC34A'; }
        else if (type === TreeType.ACACIA) { base = '#6D4C41'; tip = '#CDDC39'; }
        else if (type === TreeType.CACTUS) { base = '#2E7D32'; tip = '#43A047'; }

        return { base, tip };
    }, [type]);

    const uniforms = useMemo(() => ({
        uColorBase: { value: new THREE.Color(colors.base) },
        uColorTip: { value: new THREE.Color(colors.tip) },
        uNoiseTexture: { value: noiseTexture }
    }), [colors]);

    return (
        <RigidBody
            position={position}
            colliders={false}
            type="dynamic"
            linearDamping={0.8}
            angularDamping={0.8}
            friction={2.0}
        >
            {/* Approximate collider for the trunk */}
            <CylinderCollider args={[2.0 * scale, 0.3 * scale]} position={[0, 2.0 * scale, 0]} friction={2.0} />

            <group rotation={[0, rotation, 0]} scale={[scale, scale, scale]}>
                <mesh geometry={wood} castShadow receiveShadow>
                    <CustomShaderMaterial
                        baseMaterial={THREE.MeshStandardMaterial}
                        vertexShader={`
                            attribute vec3 aBranchAxis;
                            attribute vec3 aBranchOrigin;
                            varying vec3 vPos;
                            varying vec3 vWorldNormal;
                            varying vec3 vBranchAxis;
                            varying vec3 vBranchOrigin;
                            void main() {
                                vPos = position;
                                vWorldNormal = normalize(normalMatrix * normal);
                                vBranchAxis = aBranchAxis;
                                vBranchOrigin = aBranchOrigin;
                                csm_Position = position;
                            }
                        `}
                        fragmentShader={`
                            precision highp sampler3D;
                            varying vec3 vPos;
                            varying vec3 vWorldNormal;
                            varying vec3 vBranchAxis;
                            varying vec3 vBranchOrigin;
                            uniform vec3 uColorBase;
                            uniform vec3 uColorTip;
                            uniform sampler3D uNoiseTexture;

                            void main() {
                                // Cylindrical bark mapping around the true branch axis (per-segment).
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

                                // Keep branches/trunk brown (no tip tinting on wood).
                                vec3 col = uColorBase;
                                col *= mix(0.92, 1.05, nBase * 0.6);
                                col *= mix(1.0, 0.5, crevices * 0.8);

                                // Moss
                                float mossNoise = texture(uNoiseTexture, vPos * 0.55 + vec3(5.0)).g;
                                float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                                if (upFactor > 0.2 && mossNoise > 0.5) {
                                    col = mix(col, vec3(0.1, 0.5, 0.1), (mossNoise - 0.5) * 2.0 * upFactor);
                                }

                                csm_DiffuseColor = vec4(col, 1.0);
                                csm_Roughness = 0.8 + crevices * 0.2;
                            }
                        `}
                        uniforms={uniforms}
                        roughness={0.9}
                        toneMapped={false}
                    />
                </mesh>
                <mesh geometry={leaves} castShadow receiveShadow>
                    <CustomShaderMaterial
                        baseMaterial={THREE.MeshStandardMaterial}
                        vertexShader={`
                            varying vec3 vPos;
                            varying vec3 vNoisePos;
                            void main() {
                                vPos = position;
                                vNoisePos = (modelMatrix * vec4(position, 1.0)).xyz;
                                csm_Position = position;
                            }
                        `}
                        fragmentShader={`
                            precision highp sampler3D;
                            varying vec3 vPos;
                            varying vec3 vNoisePos;
                            uniform vec3 uColorTip;
                            uniform sampler3D uNoiseTexture;

                            void main() {
                                // Static Color Variation
                                float variation = texture(uNoiseTexture, vNoisePos * 0.08).r;
                                float micro = texture(uNoiseTexture, vNoisePos * 0.35 + vPos * 0.5 + vec3(11.0)).r;

                                // Simple Gradient
                                float gradient = smoothstep(0.0, 1.0, vPos.y * 0.2); 

                                vec3 baseLeaf = uColorTip * 0.80;
                                vec3 tintA = baseLeaf * vec3(0.82, 0.95, 0.82);
                                vec3 tintB = baseLeaf * vec3(0.95, 1.05, 0.95);
                                vec3 col = mix(tintA, tintB, variation);
                                col *= mix(0.92, 1.08, micro);
                                col *= mix(0.95, 1.05, gradient);

                                csm_DiffuseColor = vec4(col, 1.0);
                                csm_Emissive = uColorTip * 0.10;
                                csm_Roughness = 0.6;
                            }
                        `}
                        uniforms={uniforms}
                        toneMapped={false}
                    />
                </mesh>
            </group>
        </RigidBody>
    );
};
