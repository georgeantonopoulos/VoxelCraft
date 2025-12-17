import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SparkEvent {
    id: number;
    position: THREE.Vector3;
    startTime: number;
}

// Global event bus for sparks (simple window event for now to decouple)
export const emitSpark = (position: THREE.Vector3) => {
    window.dispatchEvent(new CustomEvent('vc-spark', { detail: { position } }));
};

export const SparkSystem: React.FC = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    // We'll use a pool of particles. Each "Spark" event might spawn multiple particles.
    // Actually, for performance, let's make this a simple "Burst" system.
    // We can render N particles.
    // Let's say max 100 particles alive.

    const MAX_PARTICLES = 100;
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Store particle state: [active(0/1), age(0..1), velocityX, velocityY, velocityZ]
    // We can just use an array of objects for simplicity since N is small.
    const particles = useRef<{
        active: boolean;
        pos: THREE.Vector3;
        vel: THREE.Vector3;
        age: number;
        life: number;
    }[]>([]);

    useEffect(() => {
        // Init pool
        for (let i = 0; i < MAX_PARTICLES; i++) {
            particles.current.push({
                active: false,
                pos: new THREE.Vector3(),
                vel: new THREE.Vector3(),
                age: 0,
                life: 0.5 // seconds
            });
        }

        const handleSpark = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const origin = detail.position as THREE.Vector3;

            // Spawn a burst of 5-10 particles
            let spawned = 0;
            const count = 8;
            for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
                if (!particles.current[i].active) {
                    const p = particles.current[i];
                    p.active = true;
                    p.pos.copy(origin);
                    // Random velocity cone
                    p.vel.set(
                        (Math.random() - 0.5) * 4,
                        Math.random() * 4 + 2, // Upward bias
                        (Math.random() - 0.5) * 4
                    );
                    p.age = 0;
                    p.life = 0.3 + Math.random() * 0.3;
                    spawned++;
                }
            }
        };

        window.addEventListener('vc-spark', handleSpark);
        return () => window.removeEventListener('vc-spark', handleSpark);
    }, []);

    useFrame((_, delta) => {
        if (!meshRef.current) return;

        let activeCount = 0;

        particles.current.forEach((p, i) => {
            if (p.active) {
                p.age += delta;
                if (p.age >= p.life) {
                    p.active = false;
                    // Hide
                    dummy.position.set(0, -9999, 0);
                    dummy.updateMatrix();
                    meshRef.current!.setMatrixAt(i, dummy.matrix);
                } else {
                    // Update physics
                    p.vel.y -= 9.8 * delta; // Gravity
                    p.pos.addScaledVector(p.vel, delta);

                    dummy.position.copy(p.pos);
                    dummy.scale.setScalar(Math.max(0, 1.0 - (p.age / p.life))); // Shrink
                    dummy.updateMatrix();
                    meshRef.current!.setMatrixAt(i, dummy.matrix);
                    activeCount++;
                }
            } else {
                // Ensure hidden
                dummy.position.set(0, -9999, 0);
                dummy.updateMatrix();
                meshRef.current!.setMatrixAt(i, dummy.matrix);
            }
        });

        if (activeCount > 0 || meshRef.current.count > 0) {
            meshRef.current.instanceMatrix.needsUpdate = true;
        }
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
            <boxGeometry args={[0.03, 0.03, 0.03]} /> {/* Tiny cubes */}
            <meshBasicMaterial color="#ffaa00" toneMapped={false} />
        </instancedMesh>
    );
};
