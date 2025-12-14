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
                            varying vec3 vPos;
                            varying vec3 vWorldNormal;
                            void main() {
                                vPos = position;
                                vWorldNormal = normalize(mat3(modelMatrix) * normal);
                                csm_Position = position;
                            }
                        `}
                        fragmentShader={`
                            precision highp sampler3D;
                            varying vec3 vPos;
                            varying vec3 vWorldNormal;
                            uniform vec3 uColorBase;
                            uniform vec3 uColorTip;
                            uniform sampler3D uNoiseTexture;

                            void main() {
                                // UV Mapping for Cylindrical Bark
                                float angle = atan(vPos.x, vPos.z);
                                vec2 barkUV = vec2(angle * 2.0, vPos.y * 6.0);
                                
                                float nBase = texture(uNoiseTexture, vPos * 2.5).r; 
                                float nBark = texture(uNoiseTexture, vec3(barkUV.x, barkUV.y, 0.0) * 0.5).r;
                                
                                float ridges = smoothstep(0.3, 0.7, nBark);
                                float crevices = 1.0 - ridges;

                                // Approximate depth using Y height for color gradient
                                float gradient = smoothstep(0.0, 5.0, vPos.y);
                                vec3 col = mix(uColorBase, uColorTip, gradient);
                                col *= mix(1.0, 0.5, crevices * 0.8);

                                // Moss
                                float mossNoise = texture(uNoiseTexture, vPos * 4.0 + vec3(5.0)).g;
                                float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                                if (upFactor > 0.2 && mossNoise > 0.5) {
                                    col = mix(col, vec3(0.1, 0.5, 0.1), (mossNoise - 0.5) * 2.0 * upFactor);
                                }

                                csm_DiffuseColor = vec4(col, 1.0);
                                csm_Roughness = 0.8 + crevices * 0.2;
                                
                                // Emissive tips
                                if (gradient > 0.8) {
                                    csm_Emissive = uColorTip * 0.5 * ridges;
                                }
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
                            void main() {
                                vPos = position;
                                csm_Position = position;
                            }
                        `}
                        fragmentShader={`
                            precision highp sampler3D;
                            varying vec3 vPos;
                            uniform vec3 uColorTip;
                            uniform sampler3D uNoiseTexture;

                            void main() {
                                float n = texture(uNoiseTexture, vPos * 1.5).r;
                                float veins = abs(n * 2.0 - 1.0);
                                veins = pow(veins, 3.0);
                                
                                vec3 col = uColorTip;
                                col = mix(col, col * 0.5, veins * 0.5);
                                col = mix(col, col * 1.2, smoothstep(0.0, 1.0, vPos.y * 0.2)); // Light gradient

                                csm_DiffuseColor = vec4(col, 1.0);
                                csm_Emissive = uColorTip * 0.5 * (1.0 - veins);
                                csm_Roughness = 0.4 + veins * 0.6;
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
