import React, { useRef, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useInventoryStore as useGameStore } from '@state/InventoryStore';
import { useWorldStore } from '@state/WorldStore';
import { Vector2, Vector3, Object3D } from 'three';
import { LuminaFlora } from '@features/flora/components/LuminaFlora';

export const FloraPlacer: React.FC = () => {
    const { camera, scene, raycaster } = useThree();
    const removeFloraFromInventory = useGameStore(s => s.removeFlora);

    const addEntity = useWorldStore(s => s.addEntity);
    const floraEntities = useWorldStore(s => s.entities);
    const floras = useMemo(() => Array.from(floraEntities.values()).filter(e => e.type === 'FLORA'), [floraEntities]);
    const lastPlaceTime = useRef(0);
    const terrainTargets = useRef<Object3D[]>([]);

    useEffect(() => {
        /**
         * Returns true if the object or any parent is tagged as terrain.
         */
        const isTerrain = (obj: Object3D | null): boolean => {
            let current: Object3D | null = obj;
            while (current) {
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

                raycaster.setFromCamera(new Vector2(0, 0), camera);
                // Limit raycast to terrain meshes (ancestor-aware) to reduce work without breaking hits
                terrainTargets.current = [];
                scene.traverse(obj => {
                    if ((obj as any).isMesh && isTerrain(obj)) {
                        terrainTargets.current.push(obj);
                    }
                });

                scene.updateMatrixWorld();
                raycaster.far = 24;
                const intersects = terrainTargets.current.length > 0
                    ? raycaster.intersectObjects(terrainTargets.current, false)
                    : raycaster.intersectObjects(scene.children, true);

                // Filter for terrain
                const terrainHit = intersects.find(hit => isTerrain(hit.object));

                if (terrainHit) {
                    const normal = terrainHit.face?.normal || new Vector3(0, 1, 0);
                    // Place slightly off surface
                    const pos = terrainHit.point.clone().add(normal.multiplyScalar(0.5));

                    // Create a stable ref for the new flora
                    const bodyRef = React.createRef<any>();
                    const id = Math.random().toString(36).substr(2, 9);

                    addEntity({
                        id,
                        type: 'FLORA',
                        position: pos,
                        bodyRef,
                    });

                    removeFloraFromInventory();
                    lastPlaceTime.current = now;
                }
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
