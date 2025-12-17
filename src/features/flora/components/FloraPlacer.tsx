import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useInventoryStore as useGameStore } from '@state/InventoryStore';
import { useWorldStore } from '@state/WorldStore';
import { Vector2, Vector3, Object3D, Matrix3, Quaternion } from 'three';
import type { PointLight } from 'three';
import { LuminaFlora } from '@features/flora/components/LuminaFlora';
import { PlacedTorch } from '@features/interaction/components/PlacedTorch';

function isTextInputTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export const FloraPlacer: React.FC = () => {
    const { camera, scene, raycaster } = useThree();

    const addEntity = useWorldStore(s => s.addEntity);
    const floraEntities = useWorldStore(s => s.entities);
    const floras = useMemo(() => Array.from(floraEntities.values()).filter(e => e.type === 'FLORA'), [floraEntities]);
    const torches = useMemo(() => Array.from(floraEntities.values()).filter(e => e.type === 'TORCH'), [floraEntities]);
    const lastPlaceTime = useRef(0);
    const terrainTargets = useRef<Object3D[]>([]);
    const lumaLightRefs = useRef<Array<PointLight | null>>([]);
    const debugMode = useMemo(() => {
        // Enable via `?debug`, `localStorage.vcDebugPlacement = "1"`, or `window.__vcDebugPlacement = true`.
        // Using multiple toggles helps when URL params aren't convenient during testing.
        const params = new URLSearchParams(window.location.search);
        const viaQuery = params.has('debug');
        const viaWindow = (window as any).__vcDebugPlacement === true;
        let viaStorage = false;
        try {
            viaStorage = window.localStorage.getItem('vcDebugPlacement') === '1';
        } catch {
            viaStorage = false;
        }
        return viaQuery || viaWindow || viaStorage;
    }, []);

    // Keep a small, fixed number of point lights mounted at all times.
    // Creating/removing point lights can cause a noticeable hitch due to shader/light reconfiguration.
    const LUMA_LIGHT_POOL_SIZE = 1;
    useFrame(() => {
        // Pick the nearest placed flora and attach the pooled light to it.
        // We intentionally do not create one light per flora.
        const entities = useWorldStore.getState().entities;
        let bestD2 = Infinity;
        let bestX = 0;
        let bestY = 0;
        let bestZ = 0;
        let found = false;

        entities.forEach((entity) => {
            if (entity.type !== 'FLORA') return;
            const body = (entity as any).bodyRef?.current;
            if (body && typeof body.translation === 'function') {
                const t = body.translation();
                const dx = t.x - camera.position.x;
                const dy = t.y - camera.position.y;
                const dz = t.z - camera.position.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    bestX = t.x;
                    bestY = t.y;
                    bestZ = t.z;
                    found = true;
                }
            } else if (entity.position) {
                const dx = entity.position.x - camera.position.x;
                const dy = entity.position.y - camera.position.y;
                const dz = entity.position.z - camera.position.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    bestX = entity.position.x;
                    bestY = entity.position.y;
                    bestZ = entity.position.z;
                    found = true;
                }
            }
        });

        // Pool size is currently 1; keep loop to make it easy to scale.
        for (let i = 0; i < LUMA_LIGHT_POOL_SIZE; i++) {
            const light = lumaLightRefs.current[i];
            if (!light) continue;
            if (!found) {
                light.intensity = 0;
                continue;
            }
            light.position.set(bestX, bestY + 0.15, bestZ);
            light.intensity = 1.6;
        }
    });

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

        const emitDebug = (message: string) => {
            if (!debugMode) return;
            // Visible debug hook (HUD can subscribe) + console breadcrumbs.
            window.dispatchEvent(new CustomEvent('vc-placement-debug', { detail: { message, t: Date.now() } }));
            console.log('[FloraPlacer]', message);
        };

        const handleDown = (e: MouseEvent) => {
            // Right mouse button = "use/build" for the currently selected item.
            if (e.button !== 2) return;
            // Only place items when in gameplay (pointer lock).
            if (!document.pointerLockElement) return;
            // Avoid stealing focus from UI inputs/debug panels.
            if (isTextInputTarget(e.target)) return;
            e.preventDefault();
            emitDebug('RMB received');

            const state = useGameStore.getState();
            const selectedItem = state.inventorySlots[state.selectedSlotIndex];
            emitDebug(`selectedSlot=${state.selectedSlotIndex} selectedItem=${selectedItem}`);

            // Torches are stackable and are consumed when placed.
            const wantsTorch = selectedItem === 'torch';
            const wantsFlora = selectedItem === 'flora';
            const hasFlora = state.inventoryCount > 0;
            const hasTorch = state.getItemCount('torch') > 0;

            if ((wantsTorch && hasTorch) || (wantsFlora && hasFlora)) {
                const now = performance.now();
                if (now - lastPlaceTime.current < 200) return; // Debounce
                emitDebug('placement attempt');

                raycaster.setFromCamera(new Vector2(0, 0), camera);
                // Limit raycast to terrain meshes (ancestor-aware) to reduce work without breaking hits
                terrainTargets.current = [];
                scene.traverse(obj => {
                    if ((obj as any).isMesh && isTerrain(obj)) {
                        terrainTargets.current.push(obj);
                    }
                });
                emitDebug(`terrainTargets=${terrainTargets.current.length}`);

                scene.updateMatrixWorld();
                raycaster.far = 24;
                const intersects = terrainTargets.current.length > 0
                    ? raycaster.intersectObjects(terrainTargets.current, false)
                    : raycaster.intersectObjects(scene.children, true);
                emitDebug(`intersects=${intersects.length}`);

                // Filter for terrain
                const terrainHit = intersects.find(hit => isTerrain(hit.object));

                if (terrainHit) {
                    emitDebug('terrainHit found');
                    // Face normal is in local space; transform it to world space for correct placement orientation.
                    const localNormal = terrainHit.face?.normal?.clone() || new Vector3(0, 1, 0);
                    const normalMatrix = new Matrix3().getNormalMatrix(terrainHit.object.matrixWorld);
                    const worldNormal = localNormal.applyMatrix3(normalMatrix).normalize();

                    // Create stable refs/IDs for new entities
                    const id = Math.random().toString(36).substr(2, 9);

                    if (wantsTorch) {
                        // Torch base sits on the surface; torch axis points away from the surface.
                        const pos = terrainHit.point.clone().add(worldNormal.clone().multiplyScalar(0.02));
                        const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), worldNormal);

                        addEntity({
                            id,
                            type: 'TORCH',
                            position: pos,
                            rotation
                        });
                        emitDebug(`Placed Torch id=${id}`);
                        // Consume a torch and stop holding it (back to slot 1 / empty).
                        state.removeItem('torch', 1);
                        state.setSelectedSlotIndex(0);
                    } else {
                        // Place slightly off surface so physics settles cleanly.
                        const pos = terrainHit.point.clone().add(worldNormal.clone().multiplyScalar(0.5));

                        const bodyRef = React.createRef<any>();
                        addEntity({
                            id,
                            type: 'FLORA',
                            position: pos,
                            bodyRef,
                        });

                        // Consume one flora.
                        state.removeItem('flora', 1);
                        emitDebug(`Placed Flora id=${id}`);
                    }
                    lastPlaceTime.current = now;
                } else {
                    emitDebug('no terrainHit (check terrain mesh userData tagging)');
                }
            }
        };
        // Capture phase ensures we still receive the event even if another handler stops propagation.
        // We attach to both `window` and `document` because some pointer-lock/controls setups
        // can behave differently across browsers.
        const opts: AddEventListenerOptions = { capture: true };
        window.addEventListener('mousedown', handleDown, opts);
        document.addEventListener('mousedown', handleDown, opts);
        emitDebug('mounted (mousedown listener active on window+document, capture=true)');
        return () => {
            window.removeEventListener('mousedown', handleDown, opts);
            document.removeEventListener('mousedown', handleDown, opts);
        };
    }, [camera, scene, raycaster, addEntity, debugMode]);

    return (
        <>
            {Array.from({ length: LUMA_LIGHT_POOL_SIZE }).map((_, i) => (
                <pointLight
                    // Pool key must be stable to keep the underlying Three light mounted.
                    key={`luma-light-${i}`}
                    ref={(light) => {
                        lumaLightRefs.current[i] = light;
                    }}
                    color="#E0F7FA"
                    intensity={0}
                    distance={10}
                    decay={2}
                    castShadow={false}
                />
            ))}
            {floras.map(flora => (
                <LuminaFlora
                    key={flora.id}
                    id={flora.id}
                    position={[flora.position.x, flora.position.y, flora.position.z]}
                    bodyRef={flora.bodyRef}
                />
            ))}
            {torches.map(torch => (
                torch.rotation ? (
                    <PlacedTorch
                        key={torch.id}
                        position={torch.position}
                        rotation={torch.rotation}
                    />
                ) : null
            ))}
        </>
    );
};
