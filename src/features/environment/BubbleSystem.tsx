import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEnvironmentStore } from '@/state/EnvironmentStore';

const COUNT = 50;
const RADIUS = 15;
const Y_RANGE = 20;

export const BubbleSystem: React.FC = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

    // Particle state: [x, y, z, speed, offset]
    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < COUNT; i++) {
            const x = (Math.random() - 0.5) * RADIUS * 2;
            const y = (Math.random() - 0.5) * Y_RANGE;
            const z = (Math.random() - 0.5) * RADIUS * 2;
            const speed = 0.5 + Math.random() * 1.5;
            const offset = Math.random() * Math.PI * 2;
            temp.push({ x, y, z, speed, offset });
        }
        return temp;
    }, []);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useFrame(({ camera, clock }) => {
        if (!meshRef.current) return;

        // Only show if somewhat underwater
        if (underwaterBlend < 0.1) {
            meshRef.current.visible = false;
            return;
        }
        meshRef.current.visible = true;

        const t = clock.getElapsedTime();
        const camPos = camera.position;

        particles.forEach((p, i) => {
            // Float up
            p.y += p.speed * 0.01;

            // Wiggle
            const wiggleX = Math.sin(t * 2 + p.offset) * 0.1;
            const wiggleZ = Math.cos(t * 1.5 + p.offset) * 0.1;

            // Relative wrapping logic to keep bubbles around camera without abrupt pops
            // We want them to spawn below and float up past camera?
            // Or just float around in a toroid/cube?

            // Let's keep them in a box relative to camera
            const relX = p.x + wiggleX;
            let relY = p.y;
            const relZ = p.z + wiggleZ;

            // Wrap Y
            if (relY > Y_RANGE / 2) {
                p.y -= Y_RANGE;
                relY = p.y;
            }

            // Apply to world space
            dummy.position.set(
                camPos.x + relX,
                camPos.y + relY, // Bubbles move with camera Y? No, they should stay in world Y?
                // If they loop relative to camera, they naturally follow.
                // But bubbles should rise in world space.
                // If we offset by camPos.y, they move with player vertical movement, which is weird.
                // Better: Local simulation box that follows camera position coarsely but bubbles float up.
                // Actually, for a simple effect, attached to camera frame is fine, 
                // but we add a counter-movement or just let them float up relative to camera frame is easier.
                camPos.z + relZ
            );

            // Simple scale oscillation
            const s = 0.5 + Math.sin(t * 3 + p.offset) * 0.2;
            dummy.scale.setScalar(s);

            dummy.updateMatrix();
            meshRef.current!.setMatrixAt(i, dummy.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]}>
            <sphereGeometry args={[0.05, 8, 8]} /> {/* Low poly bubbles */}
            <meshPhysicalMaterial
                transparent
                opacity={0.4}
                color="#aaccff"
                roughness={0.1}
                metalness={0.1}
                transmission={0.9} // Glassy
                thickness={0.1}
                depthWrite={false}
            />
        </instancedMesh>
    );
};
