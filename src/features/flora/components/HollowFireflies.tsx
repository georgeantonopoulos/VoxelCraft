import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface HollowFirefliesProps {
    /** Number of fireflies (default: 3) */
    count?: number;
    /** Radius of orbit around the hollow (default: 1.5) */
    radius?: number;
    /** Height range for fireflies (default: [0.5, 2.0]) */
    heightRange?: [number, number];
    /** Base seed for deterministic positioning */
    seed?: number;
}

/**
 * HollowFireflies - Blue flora fireflies that orbit around Root Hollows
 *
 * Simplified version using basic material first to debug positioning.
 */
export const HollowFireflies: React.FC<HollowFirefliesProps> = ({
    count = 3,
    radius = 1.5,
    heightRange = [0.5, 2.0],
    seed = 42
}) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Visible size for debugging
    const PARTICLE_SIZE = 0.2;

    // Generate deterministic initial positions based on seed
    const initialPositions = useMemo(() => {
        const positions: Array<{ x: number; y: number; z: number }> = [];
        for (let i = 0; i < count; i++) {
            const hash = (n: number) => {
                const x = Math.sin(n) * 43758.5453;
                return x - Math.floor(x);
            };
            const angle = (i / count) * Math.PI * 2 + hash(seed + i) * 0.5;
            const r = radius * (0.7 + hash(seed * 13.3 + i) * 0.6);
            const h = heightRange[0] + hash(seed * 7.9 + i * 17.3) * (heightRange[1] - heightRange[0]);

            positions.push({
                x: Math.cos(angle) * r,
                y: h,
                z: Math.sin(angle) * r,
            });
        }
        return positions;
    }, [count, radius, heightRange, seed]);

    useLayoutEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;

        // Set up instance matrices with positions
        for (let i = 0; i < count; i++) {
            const pos = initialPositions[i];
            dummy.position.set(pos.x, pos.y, pos.z);
            dummy.scale.setScalar(PARTICLE_SIZE);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }

        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
    }, [count, initialPositions, dummy]);

    // Simple pulsing animation
    useFrame((state) => {
        const mesh = meshRef.current;
        if (!mesh) return;

        const time = state.clock.elapsedTime;
        for (let i = 0; i < count; i++) {
            const pos = initialPositions[i];
            // Add small wobble
            const wobbleX = Math.sin(time * 0.7 + i * 2.1) * 0.15;
            const wobbleY = Math.sin(time * 0.9 + i * 1.3) * 0.15;
            const wobbleZ = Math.cos(time * 0.6 + i * 1.7) * 0.15;

            // Pulsing scale
            const pulse = 0.7 + 0.3 * Math.sin(time * 1.5 + i * Math.PI);

            dummy.position.set(pos.x + wobbleX, pos.y + wobbleY, pos.z + wobbleZ);
            dummy.scale.setScalar(PARTICLE_SIZE * pulse);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh
            ref={meshRef}
            args={[undefined, undefined, count]}
            frustumCulled={false}
        >
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial
                color="#4488ff"
                transparent
                opacity={0.9}
                toneMapped={false}
            />
        </instancedMesh>
    );
};
