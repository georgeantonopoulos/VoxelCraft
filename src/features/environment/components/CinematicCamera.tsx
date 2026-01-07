import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

export const CinematicCamera: React.FC<{ spawnPos: [number, number, number] | null }> = ({ spawnPos }) => {
    const { camera } = useThree();
    const angle = useRef(0);

    useFrame((_state, delta) => {
        angle.current += delta * 0.03; // Even slower rotation
        const radius = 25; // Much closer so we don't stream too many chunks
        const centerX = spawnPos ? spawnPos[0] : 16;
        const centerZ = spawnPos ? spawnPos[2] : 16;

        const targetY = spawnPos ? spawnPos[1] : 20;
        const camY = targetY + 25; // Fly lower

        const x = centerX + Math.sin(angle.current) * radius;
        const z = centerZ + Math.cos(angle.current) * radius;

        camera.position.lerp(new THREE.Vector3(x, camY, z), 0.1);
        camera.lookAt(centerX, targetY, centerZ);
    });

    return null;
};
