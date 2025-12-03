import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';

export const FirstPersonTools: React.FC = () => {
    const { camera } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const axeRef = useRef<THREE.Group>(null);
    const hasAxe = useInventoryStore(state => state.hasAxe);

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

    useFrame((state) => {
        if (axeRef.current) {
            // Sway animation
            const time = state.clock.getElapsedTime();
            const swayX = Math.sin(time * 2) * 0.02;
            const swayY = Math.cos(time * 4) * 0.02;

            axeRef.current.position.y = -0.4 + swayY;
            axeRef.current.position.x = 0.5 + swayX;
            axeRef.current.rotation.z = Math.sin(time * 2) * 0.05;
        }
    });

    if (!hasAxe) return null;

    return (
        <group ref={groupRef} position={[0, 0, -1]}>
            <group ref={axeRef} position={[0.5, -0.4, -0.5]} rotation={[0, -Math.PI / 4, 0]}>
                {/* Simple Axe Geometry */}
                <mesh position={[0, 0.3, 0]}>
                    <boxGeometry args={[0.1, 0.6, 0.1]} />
                    <meshStandardMaterial color="#5D4037" />
                </mesh>
                <mesh position={[0, 0.5, 0.15]}>
                    <boxGeometry args={[0.05, 0.2, 0.4]} />
                    <meshStandardMaterial color="#00FFFF" emissive="#00FFFF" emissiveIntensity={0.5} />
                </mesh>
            </group>
        </group>
    );
};
