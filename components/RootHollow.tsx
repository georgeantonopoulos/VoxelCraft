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
  varying vec3 vHollowNormal;  // Renamed to avoid collision
  varying vec3 vHollowPos;     // Renamed to avoid collision

  void main() {
    vHollowNormal = normal;
    vec4 wPos = modelMatrix * vec4(position, 1.0); // Renamed 'worldPosition' to 'wPos'
    vHollowPos = wPos.xyz;

    // Displace INWARDS
    float n = texture(uNoise, vHollowPos * 0.05).r;
    vec3 newPos = position + normal * (n * -0.4);
    csm_Position = newPos;
  }
`;

const hollowFragment = `
  varying vec3 vHollowPos;
  varying vec3 vHollowNormal;

  void main() {
    // Triplanar blend
    vec3 blend = pow(abs(vHollowNormal), vec3(4.0));
    blend /= dot(blend, vec3(1.0));

    vec3 colDirt = vec3(0.15, 0.1, 0.05);
    vec3 colMoss = vec3(0.1, 0.2, 0.05);

    float slope = vHollowNormal.y;
    vec3 finalCol = mix(colDirt, colMoss, smoothstep(0.3, 0.8, slope));

    // Fake Occlusion
    finalCol *= smoothstep(-1.0, 1.0, vHollowNormal.y) * 0.5 + 0.5;

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
             if (!body) continue;

             const fPos = body.translation();
             const distSq = (fPos.x - posVec.x)**2 + (fPos.y - posVec.y)**2 + (fPos.z - posVec.z)**2;

             if (distSq < 2.25) {
                 const vel = body.linvel();
                 if (vel.x**2 + vel.y**2 + vel.z**2 < 0.01) {
                     consumeFlora(flora.id);
                     setStatus('GROWING');
                 }
             }
        }
    });

    return (
        <group position={position}>
            <mesh scale={1.5} position={[0, 0.2, 0]}>
                <sphereGeometry args={[1, 32, 32]} />
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={hollowVertex}
                    fragmentShader={hollowFragment}
                    uniforms={uniforms}
                    roughness={1.0}
                    side={THREE.BackSide}
                    toneMapped={false}
                />
            </mesh>

            {status === 'GROWING' && (
                <FractalTree
                    seed={Math.abs(position[0] * 31 + position[2] * 17)}
                    position={[0, -0.5, 0]} // Relative to group
                />
            )}
        </group>
    );
};
