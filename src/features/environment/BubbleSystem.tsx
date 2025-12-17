import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEnvironmentStore } from '@/state/EnvironmentStore';
import { WATER_LEVEL } from '@/constants';

const MAX_BUBBLES = 800;

interface BubbleParticle {
    active: boolean;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    age: number;
    life: number;
    scaleMult: number;
}

export const BubbleSystem: React.FC = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const isUnderwater = useEnvironmentStore((s) => s.isUnderwater);
    const underwaterChangedAt = useEnvironmentStore((s) => s.underwaterChangedAt);

    // Particle pool
    const particles = useRef<BubbleParticle[]>([]);
    useEffect(() => {
        particles.current = Array.from({ length: MAX_BUBBLES }, () => ({
            active: false,
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            age: 0,
            life: 2.0,
            scaleMult: 1.0
        }));
    }, []);

    const dummy = useMemo(() => new THREE.Object3D(), []);
    const lastPos = useRef(new THREE.Vector3());
    const lastSubmergeAt = useRef(0);
    const lastBreathAt = useRef(0);
    const velYRef = useRef(0);

    const spawnBubbles = (origin: THREE.Vector3, count: number, speed: number, radius: number) => {
        let spawned = 0;
        for (let i = 0; i < MAX_BUBBLES && spawned < count; i++) {
            const p = particles.current[i];
            if (!p.active) {
                p.active = true;
                p.age = 0;
                p.life = 1.0 + Math.random() * 2.5;
                p.scaleMult = 0.5 + Math.pow(Math.random(), 2) * 2.0;

                // Position with some random spread
                p.pos.copy(origin);
                p.pos.x += (Math.random() - 0.5) * radius;
                p.pos.y += (Math.random() - 0.5) * radius;
                p.pos.z += (Math.random() - 0.5) * radius;

                // Velocity: rising speed + random splash/drift
                p.vel.set(
                    (Math.random() - 0.5) * speed * 0.5,
                    0.5 + Math.random() * 1.5 + speed * 0.2, // Rising + some entry momentum
                    (Math.random() - 0.5) * speed * 0.5
                );
                spawned++;
            }
        }
    };

    useFrame(({ camera, clock }, delta) => {
        if (!meshRef.current || particles.current.length === 0) return;

        const t = clock.getElapsedTime();
        const camPos = camera.position;

        // Calculate vertical velocity
        velYRef.current = (camPos.y - lastPos.current.y) / Math.max(0.001, delta);
        lastPos.current.copy(camPos);

        // Detect entry burst
        if (isUnderwater && underwaterChangedAt !== lastSubmergeAt.current) {
            lastSubmergeAt.current = underwaterChangedAt;
            // Negative velocity means falling in
            const entrySpeed = Math.abs(Math.min(0, velYRef.current));
            if (entrySpeed > 2.0) {
                const burstCount = Math.floor(THREE.MathUtils.clamp(entrySpeed * 20, 30, 150));
                const burstRadius = THREE.MathUtils.clamp(entrySpeed * 0.1, 0.5, 2.0);
                spawnBubbles(camPos, burstCount, entrySpeed * 0.5, burstRadius);
            }
        }

        // Oxygen emission (breath)
        if (isUnderwater && t - lastBreathAt.current > 0.4 + Math.random() * 0.6) {
            lastBreathAt.current = t;
            // Spawn a few bubbles near the face/mouth area
            // We'll place them slightly in front of camera
            const front = new THREE.Vector3(0, -0.2, -0.4).applyEuler(camera.rotation);
            const mouthPos = camPos.clone().add(front);
            spawnBubbles(mouthPos, 2 + Math.floor(Math.random() * 3), 0.5, 0.2);
        }

        // Update active particles
        let anyActive = false;
        particles.current.forEach((p, i) => {
            if (!p.active) {
                dummy.scale.setScalar(0);
                dummy.updateMatrix();
                meshRef.current!.setMatrixAt(i, dummy.matrix);
                return;
            }

            anyActive = true;
            p.age += delta;

            // Physics: float up + drift
            p.vel.y += 0.5 * delta; // Accelerate rise slightly
            p.pos.addScaledVector(p.vel, delta);

            // Wiggle
            p.pos.x += Math.sin(t * 1.5 + i) * 0.01;
            p.pos.z += Math.cos(t * 1.5 + i) * 0.01;

            // Surface mask
            const surfaceDist = WATER_LEVEL - p.pos.y;
            const surfaceMask = THREE.MathUtils.clamp(surfaceDist * 5.0, 0, 1);

            const lifeProgress = p.age / p.life;
            if (lifeProgress >= 1.0 || surfaceMask <= 0) {
                p.active = false;
                dummy.scale.setScalar(0);
            } else {
                // Scale animation
                const s = (0.7 + Math.sin(t * 4 + i) * 0.3) * p.scaleMult * Math.min(1.0, (1.0 - lifeProgress) * 4.0) * surfaceMask;
                dummy.position.copy(p.pos);
                dummy.scale.setScalar(Math.max(0, s));
            }

            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummy.matrix);
        });

        if (anyActive) {
            meshRef.current.instanceMatrix.needsUpdate = true;
        }
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_BUBBLES]} frustumCulled={false}>
            <sphereGeometry args={[0.04, 10, 8]} />
            <meshPhysicalMaterial
                transparent
                opacity={0.8}
                color="#e0f4ff"
                roughness={0.0}
                metalness={0.2}
                transmission={0.4}
                thickness={0.5}
                ior={1.33}
                depthWrite={false}
                emissive="#99ccff"
                emissiveIntensity={0.6} // Brighter glow for "oxygen" visibility
            />
        </instancedMesh>
    );
};

