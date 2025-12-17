import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEnvironmentStore } from '@/state/EnvironmentStore';

const COUNT = 600;
const RADIUS = 25;
const Y_RANGE = 30;

export const BubbleSystem: React.FC = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

    // Particle state: [x, y, z, speed, offset, scaleMult]
    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < COUNT; i++) {
            // Some bubbles are randomly scattered, some are in loose vertical streams
            const isStream = Math.random() > 0.8;
            let x, z;

            if (isStream) {
                // Clustered around a few stream centers
                const streamCenterX = (Math.random() - 0.5) * RADIUS * 1.8;
                const streamCenterZ = (Math.random() - 0.5) * RADIUS * 1.8;
                x = streamCenterX + (Math.random() - 0.5) * 1.0;
                z = streamCenterZ + (Math.random() - 0.5) * 1.0;
            } else {
                x = (Math.random() - 0.5) * RADIUS * 2;
                z = (Math.random() - 0.5) * RADIUS * 2;
            }

            const y = (Math.random() - 0.5) * Y_RANGE;
            const speed = 0.8 + Math.random() * 2.5; // Faster rise
            const offset = Math.random() * Math.PI * 2;
            const scaleMult = 0.4 + Math.pow(Math.random(), 2) * 1.6; // Variety in sizes
            temp.push({ x, y, z, speed, offset, scaleMult });
        }
        return temp;
    }, []);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useFrame(({ camera, clock }) => {
        if (!meshRef.current) return;

        // Optimization: Always keep mesh visible to prevent shader re-compile lag.
        // Instead, we just hide instances by scaling to 0 when not needed.
        const isUnderwater = underwaterBlend > 0.05;

        const t = clock.getElapsedTime();
        const camPos = camera.position;

        particles.forEach((p, i) => {
            if (!isUnderwater) {
                // Hide by scaling to 0
                dummy.position.set(0, -9999, 0);
                dummy.scale.setScalar(0);
                dummy.updateMatrix();
                meshRef.current!.setMatrixAt(i, dummy.matrix);
                return;
            }

            // Float up in world space relative to camera spawn
            p.y += p.speed * 0.015;

            // Wiggle (more organic)
            const wiggleX = Math.sin(t * 1.8 + p.offset) * 0.15;
            const wiggleZ = Math.cos(t * 1.2 + p.offset) * 0.15;

            let relY = p.y;

            // Wrap Y relative to camera to keep volume filled
            const halfY = Y_RANGE / 2;
            if (relY > halfY) {
                p.y -= Y_RANGE;
                relY = p.y;
            }

            // Apply to world space centered on camera
            dummy.position.set(
                camPos.x + p.x + wiggleX,
                camPos.y + relY,
                camPos.z + p.z + wiggleZ
            );

            // Scale oscillation + base scale variety + fade in with submerged blend
            const s = (0.7 + Math.sin(t * 4 + p.offset) * 0.3) * p.scaleMult * underwaterBlend;
            dummy.scale.setScalar(Math.max(0, s));

            // Face camera for better highlight consistency? No, they are spheres.

            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummy.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} frustumCulled={false}>
            <sphereGeometry args={[0.08, 12, 10]} />
            <meshPhysicalMaterial
                transparent
                opacity={0.8}
                color="#e0f4ff"
                roughness={0.0}
                metalness={0.2}
                transmission={0.4} // Less transparent for visibility
                thickness={0.5}
                ior={1.33}
                depthWrite={false}
                emissive="#99ccff" // Subtle glow to help in dark water
                emissiveIntensity={0.4}
            />
        </instancedMesh>
    );
};

