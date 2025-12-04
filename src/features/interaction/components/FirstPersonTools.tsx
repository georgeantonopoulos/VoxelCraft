import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';

// Preload the model to avoid pop-in
useGLTF.preload('/src/assets/models/pickaxe.glb');

export const FirstPersonTools: React.FC = () => {
    const { camera } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const axeRef = useRef<THREE.Group>(null);
    const hasAxe = useInventoryStore(state => state.hasAxe);

    // Load the GLB model
    const { scene } = useGLTF('/src/assets/models/pickaxe.glb');

    // Animation state
    const isDigging = useRef(false);
    const digProgress = useRef(0);
    const digSpeed = 15.0; // Speed of the chop

    useEffect(() => {
        if (groupRef.current) {
            camera.add(groupRef.current);
        }
        return () => {
            if (groupRef.current) {
                camera.remove(groupRef.current);
            }
        };
    }, [camera]);

    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            if (e.button === 0 && hasAxe && !isDigging.current) {
                isDigging.current = true;
                digProgress.current = 0;
            }
        };
        window.addEventListener('mousedown', handleMouseDown);
        return () => window.removeEventListener('mousedown', handleMouseDown);
    }, [hasAxe]);

    useFrame((state, delta) => {
        if (axeRef.current) {
            const time = state.clock.getElapsedTime();

            // Base sway (breathing/walking idle)
            const swayX = Math.sin(time * 2) * 0.02;
            const swayY = Math.cos(time * 4) * 0.02;

            let rotationX = 0;
            let rotationZ = 0;
            let positionY = -0.4 + swayY;
            let positionX = 0.5 + swayX;
            let positionZ = -0.5;

            // Dig Animation Logic
            if (isDigging.current) {
                digProgress.current += delta * digSpeed;

                // Animation phase: 0 -> PI (down), PI -> 2PI (reset)
                // We want a sharp chop down, then slower return
                if (digProgress.current < Math.PI) {
                    // Chop down
                    const t = digProgress.current;
                    rotationX = -Math.sin(t) * 1.5; // Rotate forward/down
                    rotationZ = -Math.sin(t) * 0.5; // Tilt inward slightly
                    positionY -= Math.sin(t) * 0.2; // Move down
                    positionZ -= Math.sin(t) * 0.3; // Move forward
                } else {
                    // Reset
                    isDigging.current = false;
                    digProgress.current = 0;
                }
            } else {
                // Idle rotation
                rotationZ = Math.sin(time * 2) * 0.05;
            }

            // Apply transforms
            // Initial rotation to position the model correctly (it might be upright in GLB)
            // Adjust these base rotations based on how the GLB is oriented
            axeRef.current.position.set(positionX, positionY, positionZ);
            axeRef.current.rotation.set(
                rotationX,
                -Math.PI / 4, // Base Y rotation to face inward
                rotationZ + Math.PI / 4 // Base Z tilt
            );
        }
    });

    if (!hasAxe) return null;

    return (
        <group ref={groupRef} position={[0, 0, -1]}>
            <group ref={axeRef}>
                {/* Scale the model down if it's too big */}
                <primitive
                    object={scene}
                    scale={0.5}
                    rotation={[0, Math.PI / 2, 0]} // Adjust model orientation within the group
                />
            </group>
        </group>
    );
};
