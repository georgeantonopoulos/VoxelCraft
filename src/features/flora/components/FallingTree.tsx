import React, { useMemo } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { getNoiseTexture } from '@core/memory/sharedResources';
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
        let tip = '#4CAF50'; // Default to green (not cyan)

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
        uNoiseTexture: { value: getNoiseTexture() },
        // Stable per-tree seed so per-leaf variation doesn't repeat identically between trees.
        uTreeSeed: { value: seed },
        // Per-tree hue shift for visible color variety (0.30 ≈ 17 degrees).
        uLeafHueVariation: { value: 0.30 }
    }), [colors, seed]);

    return (
        <RigidBody
            position={position}
            colliders={false}
            type="dynamic"
            linearDamping={6.0}
            angularDamping={8.0}
            mass={150 * scale}
            friction={3.0}
            restitution={0}
        >
            {/* Approximate collider for the trunk - positioned so it pivots from the base slightly */}
            <CylinderCollider args={[2.0 * scale, 0.35 * scale]} position={[0, 2.0 * scale, 0]} friction={3.0} restitution={0} />

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
                            attribute float aLeafRand;
                            varying vec3 vPos;
                            varying vec3 vNoisePos;
                            varying float vHueCos;
                            varying float vHueSin;
                            varying float vTreeSeedF;
                            uniform float uTreeSeed;
                            uniform float uLeafHueVariation;

                            float hash11(float p) {
                                return fract(sin(p) * 43758.5453123);
                            }
                            void main() {
                                vPos = position;
                                vTreeSeedF = uTreeSeed;
                                
                                // Offset noise coords by tree seed so each tree samples different noise
                                vec3 treeNoiseOffset = vec3(uTreeSeed * 50.0, uTreeSeed * 37.0, uTreeSeed * 23.0);
                                vNoisePos = position + treeNoiseOffset;

                                // Per-leaf hue jitter (computed per-vertex to keep fragment cost low).
                                float hueN = hash11(aLeafRand * 113.1 + uTreeSeed * 19.7);
                                float hueAngle = (hueN * 2.0 - 1.0) * uLeafHueVariation;
                                vHueCos = cos(hueAngle);
                                vHueSin = sin(hueAngle);
                                csm_Position = position;
                            }
                        `}
                        fragmentShader={`
                            precision highp sampler3D;
                            varying vec3 vPos;
                            varying vec3 vNoisePos;
                            varying float vHueCos;
                            varying float vHueSin;
                            varying float vTreeSeedF;
                            uniform vec3 uColorTip;
                            uniform sampler3D uNoiseTexture;

                            vec3 hueRotateCS(vec3 color, float c, float s) {
                                vec3 k = vec3(0.57735026919); // normalize(vec3(1.0))
                                return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
                            }

                            void main() {
                                // Per-tree brightness/saturation variation
                                float treeBrightness = 0.85 + vTreeSeedF * 0.30;
                                float treeSaturation = 0.90 + fract(vTreeSeedF * 7.3) * 0.20;
                                
                                // Static Color Variation (using noise offset by tree seed)
                                float variation = texture(uNoiseTexture, vNoisePos * 0.15).r;
                                float micro = texture(uNoiseTexture, vNoisePos * 0.4 + vPos * 0.5 + vec3(11.0)).r;

                                // Simple Gradient
                                float gradient = smoothstep(0.0, 1.0, vPos.y * 0.2); 

                                // Base leaf color with wider tint variation
                                vec3 baseLeaf = uColorTip * 0.80 * treeBrightness;
                                vec3 tintA = baseLeaf * vec3(0.70, 0.95, 0.75);
                                vec3 tintB = baseLeaf * vec3(1.0, 1.10, 0.95);
                                vec3 col = mix(tintA, tintB, variation);
                                col *= mix(0.88, 1.12, micro);
                                col *= mix(0.90, 1.08, gradient);
                                
                                // Apply saturation adjustment
                                float lum = dot(col, vec3(0.299, 0.587, 0.114));
                                col = mix(vec3(lum), col, treeSaturation);

                                col = clamp(hueRotateCS(col, vHueCos, vHueSin), 0.0, 1.0);

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
