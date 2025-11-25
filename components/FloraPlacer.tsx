import React, { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useGameStore } from '../services/GameManager';
import { Raycaster, Vector2, Vector3, Mesh } from 'three';
import { useKeyboardControls } from '@react-three/drei';
import { LuminaFlora } from './LuminaFlora';

export const FloraPlacer: React.FC = () => {
    const { camera, scene, raycaster } = useThree();
    const [sub, get] = useKeyboardControls();
    const inventory = useGameStore(s => s.inventoryCount);
    const placeFlora = useGameStore(s => s.placeFlora);
    const placedFloras = useGameStore(s => s.placedFloras);
    const lastPlaceTime = useRef(0);

    useFrame((state) => {
        const { e } = get() as any; // Assuming 'e' is mapped? Wait, I need to map 'E' key first.

        // Custom key handler for 'E' since it might not be in the default map
        // Or I can add it to the map in App.tsx.
        // For now, let's use a native listener or check via Drei if mapped.
        // Actually, let's just use native listener for simplicity or add to map.
    });

    useEffect(() => {
        const handleDown = (e: KeyboardEvent) => {
            if (e.code === 'KeyE') {
                if (useGameStore.getState().inventoryCount > 0) {
                    const now = performance.now();
                    if (now - lastPlaceTime.current < 200) return; // Debounce

                    raycaster.setFromCamera(new Vector2(0, 0), camera);
                    const intersects = raycaster.intersectObjects(scene.children, true);

                    // Filter for terrain
                    const terrainHit = intersects.find(hit => {
                        // Check if hit object is terrain (chunk mesh)
                        return hit.object.userData?.type === 'terrain';
                    });

                    if (terrainHit) {
                        const normal = terrainHit.face?.normal || new Vector3(0, 1, 0);
                        // Place slightly off surface
                        const pos = terrainHit.point.clone().add(normal.multiplyScalar(0.5));
                        placeFlora(pos);
                        lastPlaceTime.current = now;
                    }
                }
            }
        };
        window.addEventListener('keydown', handleDown);
        return () => window.removeEventListener('keydown', handleDown);
    }, [camera, scene, raycaster, placeFlora]);

    return (
        <>
            {placedFloras.map(flora => (
                <LuminaFlora key={flora.id} position={[flora.position.x, flora.position.y, flora.position.z]} />
            ))}
        </>
    );
};
