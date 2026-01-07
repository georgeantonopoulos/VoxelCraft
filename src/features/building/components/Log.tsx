import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

// Log dimensions
const LOG_LENGTH = 2.0;
const LOG_RADIUS = 0.25;

// Get bark color based on tree type (matches FallingTree colors)
function getBarkColorForTreeType(treeType: number): string {
    switch (treeType) {
        case TreeType.OAK: return '#4e342e';
        case TreeType.PINE: return '#3e2723';
        case TreeType.PALM: return '#795548';
        case TreeType.ACACIA: return '#6D4C41';
        case TreeType.CACTUS: return '#2E7D32';
        case TreeType.JUNGLE: return '#5D4037';
        default: return '#5D4037';
    }
}

export interface LogProps {
    id: string;
    position: THREE.Vector3;
    treeType: number;
    seed: number;
    isPlaced?: boolean;  // Kinematic when placed for building
    onInteract?: (id: string) => void;
}

export const Log: React.FC<LogProps> = ({
    id,
    position,
    treeType,
    seed,
    isPlaced = false,
    onInteract
}) => {
    const bodyRef = useRef<any>(null);
    const barkColor = getBarkColorForTreeType(treeType);

    // Wood material with bark texture (simplified from FallingTree)
    const woodMaterial = useMemo(() => {
        return new (CustomShaderMaterial as any)({
            baseMaterial: THREE.MeshStandardMaterial,
            vertexShader: `
                varying vec3 vPos;
                varying vec3 vWorldNormal;
                void main() {
                    vPos = position;
                    vWorldNormal = normalize(normalMatrix * normal);
                    csm_Position = position;
                }
            `,
            fragmentShader: `
                precision highp sampler3D;
                varying vec3 vPos;
                varying vec3 vWorldNormal;
                uniform vec3 uColorBase;
                uniform sampler3D uNoiseTexture;
                uniform float uSeed;

                void main() {
                    // Cylindrical bark mapping
                    float angle = atan(vPos.x, vPos.z);
                    vec3 barkP = vec3(cos(angle), sin(angle), vPos.y * 1.5);

                    float nBase = texture(uNoiseTexture, vPos * 0.35 + vec3(uSeed * 0.1)).r;
                    float nBark = texture(uNoiseTexture, barkP * 0.8 + vec3(uSeed * 0.2)).r;

                    float ridges = smoothstep(0.3, 0.7, nBark);
                    float crevices = 1.0 - ridges;

                    vec3 col = uColorBase;
                    col *= mix(0.92, 1.05, nBase * 0.6);
                    col *= mix(1.0, 0.5, crevices * 0.8);

                    // Moss on upward-facing surfaces
                    float mossNoise = texture(uNoiseTexture, vPos * 0.55 + vec3(5.0)).g;
                    float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
                    if (upFactor > 0.2 && mossNoise > 0.5) {
                        col = mix(col, vec3(0.1, 0.5, 0.1), (mossNoise - 0.5) * 2.0 * upFactor * 0.5);
                    }

                    csm_DiffuseColor = vec4(col, 1.0);
                    csm_Roughness = 0.8 + crevices * 0.2;
                }
            `,
            uniforms: {
                uColorBase: { value: new THREE.Color(barkColor) },
                uNoiseTexture: { value: getNoiseTexture() },
                uSeed: { value: seed },
            },
            roughness: 0.85,
            toneMapped: false,
        });
    }, [barkColor, seed]);

    // Cut ring material for log ends (lighter wood grain)
    const endMaterial = useMemo(() => {
        return new THREE.MeshStandardMaterial({
            color: '#8D6E63',
            roughness: 0.9,
        });
    }, []);

    // Initial rotation based on seed for variety
    const initialRotation = useMemo(() => {
        const r = (seed % 1) * Math.PI * 2;
        return [0, r, Math.PI / 2] as [number, number, number]; // Horizontal orientation
    }, [seed]);

    return (
        <RigidBody
            ref={bodyRef}
            position={position}
            rotation={initialRotation}
            type={isPlaced ? 'kinematicPosition' : 'dynamic'}
            colliders={false}
            mass={50}
            friction={2.0}
            linearDamping={4.0}
            angularDamping={6.0}
            restitution={0.1}
            userData={{ type: 'log', id, treeType }}
        >
            <CylinderCollider
                args={[LOG_LENGTH / 2, LOG_RADIUS]}
                friction={2.0}
                restitution={0.1}
            />

            <group>
                {/* Main log cylinder */}
                <mesh material={woodMaterial} castShadow receiveShadow>
                    <cylinderGeometry args={[LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 12]} />
                </mesh>

                {/* End caps with visible rings */}
                <mesh
                    position={[0, LOG_LENGTH / 2, 0]}
                    material={endMaterial}
                    castShadow
                >
                    <circleGeometry args={[LOG_RADIUS, 12]} />
                </mesh>
                <mesh
                    position={[0, -LOG_LENGTH / 2, 0]}
                    rotation={[Math.PI, 0, 0]}
                    material={endMaterial}
                    castShadow
                >
                    <circleGeometry args={[LOG_RADIUS, 12]} />
                </mesh>
            </group>
        </RigidBody>
    );
};
