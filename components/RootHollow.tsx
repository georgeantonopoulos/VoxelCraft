import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { useGameStore } from '../services/GameManager';
import { FractalTree } from './FractalTree';
import { getNoiseTexture } from '../utils/sharedResources';

interface RootHollowProps {
    position: [number, number, number];
}

export const RootHollow: React.FC<RootHollowProps> = ({ position }) => {
    const [status, setStatus] = useState<'IDLE' | 'GROWING'>('IDLE');
    const consumeFlora = useGameStore(s => s.consumeFlora);
    const placedFloras = useGameStore(s => s.placedFloras);

    // Memoize vector to avoid recreation
    const posVec = useMemo(() => new THREE.Vector3(...position), [position]);

    // Check interaction
    useFrame(() => {
        if (status !== 'IDLE') return;

        // Scan floras
        for (const flora of placedFloras) {
             const body = flora.bodyRef?.current;
             if (!body) continue;

             const fPos = body.translation();
             const distSq = (fPos.x - posVec.x)**2 + (fPos.y - posVec.y)**2 + (fPos.z - posVec.z)**2;

             if (distSq < 2.25) { // 1.5m radius
                 const vel = body.linvel();
                 const speedSq = vel.x**2 + vel.y**2 + vel.z**2;

                 if (speedSq < 0.01) { // Settled
                     consumeFlora(flora.id);
                     setStatus('GROWING');
                 }
             }
        }
    });

    const uniforms = useMemo(() => ({
        uNoise: { value: getNoiseTexture() }
    }), []);

    return (
        <group position={position}>
            {/* The Hollow Visual - Inverted Sphere to look like a hole */}
            <mesh scale={[1.2, 1.2, 1.2]} position={[0, 0.0, 0]}>
                <sphereGeometry args={[1, 32, 32]} />
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={`
                        uniform sampler3D uNoise;
                        varying vec3 vPos;

                        void main() {
                            vPos = position;
                            // Displacement logic using the shared 3D noise texture
                            vec3 p = (modelMatrix * vec4(position, 1.0)).xyz * 0.5;
                            float n = texture(uNoise, p).r;

                            // Displace slightly to make it organic
                            vec3 newPos = position + normal * (n * 0.3);
                            csm_Position = newPos;
                        }
                    `}
                    fragmentShader={`
                         // Passthrough to standard material
                    `}
                    uniforms={uniforms}
                    color="#1a1510"
                    roughness={0.4}
                    side={THREE.BackSide} // Render inside
                    toneMapped={false}
                />
            </mesh>

            {status === 'GROWING' && (
                <FractalTree
                    seed={Math.abs(position[0] * 31 + position[2] * 17)}
                    position={new THREE.Vector3(0, -0.5, 0)} // Grow from bottom of hollow
                />
            )}
        </group>
    );
};
