import React, { useRef, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useInventoryStore as useGameStore } from '@state/InventoryStore';
import { useWorldStore } from '@state/WorldStore';
import { Vector2, Vector3, Object3D, Mesh } from 'three';
import { LuminaFlora } from '@features/flora/components/LuminaFlora';

export const FloraPlacer: React.FC = () => {
    const { camera, scene, raycaster } = useThree();
    const removeFloraFromInventory = useGameStore(s => s.removeFlora);
    const addEntity = useWorldStore(s => s.addEntity);
    const floraEntities = useWorldStore(s => s.entities);
    
    // Convert to array only when necessary
    const floras = useMemo(() => Array.from(floraEntities.values()).filter(e => e.type === 'FLORA'), [floraEntities]);
    const lastPlaceTime = useRef(0);

    useEffect(() => {
        // Helper: Check if hit object is valid terrain
        const isTerrain = (obj: Object3D | null): boolean => {
            let current: Object3D | null = obj;
            while (current) {
                // Check userData on RigidBody (Group) or Mesh
                if (current.userData?.type === 'terrain') return true;
                current = current.parent;
            }
            return false;
        };

        const handleDown = (e: KeyboardEvent) => {
            if (e.code !== 'KeyE') return;

            if (useGameStore.getState().inventoryCount > 0) {
                const now = performance.now();
                if (now - lastPlaceTime.current < 200) return; // Debounce

                // 1. Setup Raycaster
                raycaster.setFromCamera(new Vector2(0, 0), camera);
                raycaster.far = 32;
                
                // CRITICAL OPTIMIZATION:
                // Since we added 'computeBoundsTree' to ChunkMesh, we can use 
                // 'firstHitOnly' via the accelerated raycast which is O(log n).
                // No need to manually filter 'terrainTargets'.
                // Just raycast against the scene and filter the result.
                (raycaster as any).firstHitOnly = true; 
                
                const intersects = raycaster.intersectObjects(scene.children, true);

                // 2. Find first valid terrain hit
                const terrainHit = intersects.find(hit => isTerrain(hit.object));

                if (terrainHit) {
                    const normal = terrainHit.face?.normal || new Vector3(0, 1, 0);
                    const pos = terrainHit.point.clone().add(normal.multiplyScalar(0.5));

                    addEntity({
                        id: Math.random().toString(36).substr(2, 9),
                        type: 'FLORA',
                        position: pos,
                        bodyRef: React.createRef(),
                    });

                    removeFloraFromInventory();
                    lastPlaceTime.current = now;
                }
                
                (raycaster as any).firstHitOnly = false; // Reset
            }
        };
        window.addEventListener('keydown', handleDown);
        return () => window.removeEventListener('keydown', handleDown);
    }, [camera, scene, raycaster, addEntity, removeFloraFromInventory]);

    return (
        <>
            {floras.map(flora => (
                <LuminaFlora
                    key={flora.id}
                    id={flora.id}
                    position={[flora.position.x, flora.position.y, flora.position.z]}
                    bodyRef={flora.bodyRef}
                />
            ))}
        </>
    );
};