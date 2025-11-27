import React, { useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { useGameStore } from '../services/GameManager';
import { FractalTree } from './FractalTree';
import { getNoiseTexture } from '../utils/sharedResources';

interface RootHollowProps {
    position: [number, number, number];
}

const hollowVertex = `
  uniform sampler3D uNoise;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vNormal = normal;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;

    // Displace INWARDS (negative normal) to create the hollow effect
    float n = texture(uNoise, vWorldPos * 0.05).r;
    vec3 newPos = position + normal * (n * -0.4);
    csm_Position = newPos;
  }
`;

const hollowFragment = `
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    // Triplanar blend for organic look
    vec3 blend = pow(abs(vNormal), vec3(4.0));
    blend /= dot(blend, vec3(1.0));

    vec3 colDirt = vec3(0.15, 0.1, 0.05); // Deep Dark Dirt
    vec3 colMoss = vec3(0.1, 0.2, 0.05);  // Dark Cave Moss

    // Vertical blend
    float slope = vNormal.y;
    vec3 finalCol = mix(colDirt, colMoss, smoothstep(0.3, 0.8, slope));

    // Fake Occlusion (darker at bottom)
    finalCol *= smoothstep(-1.0, 1.0, vNormal.y) * 0.5 + 0.5;

    csm_DiffuseColor = vec4(finalCol, 1.0);
  }
`;

export const RootHollow: React.FC<RootHollowProps> = ({ position }) => {
    const [status, setStatus] = useState<'IDLE' | 'GROWING'>('IDLE');
    const consumeFlora = useGameStore(s => s.consumeFlora);
    const placedFloras = useGameStore(s => s.placedFloras);

    const posVec = useMemo(() => new THREE.Vector3(...position), [position]);
    const uniforms = useMemo(() => ({ uNoise: { value: getNoiseTexture() } }), []);

    useFrame(() => {
        if (status !== 'IDLE') return;

        for (const flora of placedFloras) {
             const body = flora.bodyRef?.current;
             // If physics body exists, use it. If not (just placed), use react state position
             const floraPos = body ? body.translation() : flora.position;

             const distSq = (floraPos.x - posVec.x)**2 + (floraPos.y - posVec.y)**2 + (floraPos.z - posVec.z)**2;

             // Interaction Radius: 1.5m
             if (distSq < 2.25) {
                 // Check velocity if body exists to ensure it's "settled"
                 const vel = body ? body.linvel() : {x:0, y:0, z:0};
                 if (vel.x**2 + vel.y**2 + vel.z**2 < 0.01) {
                     consumeFlora(flora.id);
                     setStatus('GROWING');
                 }
             }
        }
    });

    return (
        <group position={position}>
            {/* The Hollow Visual */}
            <mesh scale={1.5} position={[0, 0.2, 0]}>
                <sphereGeometry args={[1, 32, 32]} />
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={hollowVertex}
                    fragmentShader={hollowFragment}
                    uniforms={uniforms}
                    roughness={1.0}
                    side={THREE.BackSide} // Render Inside
                    toneMapped={false}
                />
            </mesh>

            {status === 'GROWING' && (
                <FractalTree
                    seed={Math.abs(position[0] * 31 + position[2] * 17)}
                    position={new THREE.Vector3(0, -0.5, 0)}
                />
            )}
        </group>
    );
};
