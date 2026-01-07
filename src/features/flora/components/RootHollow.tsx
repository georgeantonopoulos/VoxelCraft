import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useWorldStore } from '@state/WorldStore';
import { ItemType } from '@/types';
import { FractalTree } from '@features/flora/components/FractalTree';
import { LumaSwarm } from '@features/flora/components/LumaSwarm';
import { HollowFireflies } from '@features/flora/components/HollowFireflies';

const stumpUrl = "/models/tree_stump.glb";

// AAA Visual Config - Matching the reference image
const STUMP_CONFIG = {
    height: 1.4,
    scale: 1.3,
    embedOffset: 0.3
};

interface RootHollowProps {
    position: [number, number, number];
    normal?: number[]; // [nx, ny, nz]
}

/**
 * RootHollow component - AAA Quality Procedural Stump
 * Features:
 * - Finite Difference Normal Recomputation for correct lighting
 * - Smooth, organic root flares matching slope
 * - High-poly geometry for clean displacement
 */
export const RootHollow: React.FC<RootHollowProps> = ({
    position,
    normal = [0, 1, 0]
}) => {
    const [status, setStatus] = useState<'IDLE' | 'CHARGING' | 'GROWING'>('IDLE');
    const [swarmVisible, setSwarmVisible] = useState(false);
    const [swarmDissipating, setSwarmDissipating] = useState(false);

    const removeEntity = useWorldStore(s => s.removeEntity);
    const getEntitiesNearby = useWorldStore(s => s.getEntitiesNearby);
    const posVec = useMemo(() => new THREE.Vector3(...position), [position]);

    // Unique ID for this hollow's grown tree (stable across re-renders)
    const treeEntityId = useMemo(() => `grown-tree-${position[0]}-${position[2]}`, [position]);

    // Use ref to track timer so we can properly clean it up
    const growTimerRef = useRef<NodeJS.Timeout | null>(null);
    const dissipateStartTimerRef = useRef<NodeJS.Timeout | null>(null);
    const dissipateTimerRef = useRef<NodeJS.Timeout | null>(null);
    // Track if tree has been registered to prevent repeated addEntity calls
    const treeRegisteredRef = useRef(false);

    // Orientation Logic (used for the tree and swarm placement)
    const quaternion = useMemo(() => {
        const up = new THREE.Vector3(0, 1, 0);
        const nx = normal[0] || 0;
        const ny = normal[1] || 1;
        const nz = normal[2] || 0;

        const terrainNormal = new THREE.Vector3(nx, ny, nz).normalize();
        const targetDirection = new THREE.Vector3()
            .copy(terrainNormal)
            .lerp(up, 0.7)
            .normalize();

        const q = new THREE.Quaternion().setFromUnitVectors(up, targetDirection);
        const hash = Math.abs(Math.sin(position[0] * 12.9898 + position[2] * 78.233) * 43758.5453);
        const randomAngle = (hash % 1) * Math.PI * 2;

        const randomYaw = new THREE.Quaternion().setFromAxisAngle(targetDirection, randomAngle);
        q.multiply(randomYaw);

        return q;
    }, [normal[0], normal[1], normal[2], position[0], position[2]]);

    // Transition Logic
    useEffect(() => {
        if (growTimerRef.current) { clearTimeout(growTimerRef.current); growTimerRef.current = null; }
        if (dissipateStartTimerRef.current) { clearTimeout(dissipateStartTimerRef.current); dissipateStartTimerRef.current = null; }
        if (dissipateTimerRef.current) { clearTimeout(dissipateTimerRef.current); dissipateTimerRef.current = null; }

        if (status === 'CHARGING') {
            console.log('[RootHollow] Starting 10 second particle formation timer');
            setSwarmDissipating(false);
            growTimerRef.current = setTimeout(() => {
                console.log('[RootHollow] Timer complete, transitioning to GROWING');
                setStatus('GROWING');
            }, 10000);
        }

        if (status === 'GROWING') {
            // Register the grown tree in WorldStore for humidity spreading (only once!)
            if (!treeRegisteredRef.current) {
                treeRegisteredRef.current = true;
                // Use getState() to avoid dependency on addEntity reference
                useWorldStore.getState().addEntity({
                    id: treeEntityId,
                    type: 'GROWN_TREE' as const,
                    position: posVec.clone(),
                    grownAt: Date.now()
                });
                console.log('[RootHollow] Registered grown tree for humidity spreading:', treeEntityId);
            }

            dissipateStartTimerRef.current = setTimeout(() => {
                console.log('[RootHollow] Starting swarm dissipation');
                setSwarmDissipating(true);
            }, 2200);
            dissipateTimerRef.current = setTimeout(() => {
                console.log('[RootHollow] Hiding swarm');
                setSwarmVisible(false);
            }, 3800);
        }

        return () => {
            if (growTimerRef.current) clearTimeout(growTimerRef.current);
            if (dissipateStartTimerRef.current) clearTimeout(dissipateStartTimerRef.current);
            if (dissipateTimerRef.current) clearTimeout(dissipateTimerRef.current);
        };
    }, [status, treeEntityId, posVec]);

    const frameCount = useRef(0);
    useFrame((state) => {
        // OPTIMIZATION: Only run scanning if player is nearby (< 10 units)
        const playerDistSq = state.camera.position.distanceToSquared(posVec);
        if (playerDistSq > 100) return; // 10^2 = 100

        if (status !== 'IDLE') return;

        frameCount.current++;
        if (frameCount.current % 20 !== 0) return;

        const nearbyEntities = getEntitiesNearby(posVec, 4.0); // Search wider to catch flora at different Y levels

        for (const entity of nearbyEntities) {
            if (entity.type !== ItemType.FLORA) continue;

            const body = entity.bodyRef?.current;
            if (!body) {
                // Flora entity exists but RigidBody ref not yet populated - try position fallback
                const entityPos = entity.position;
                if (entityPos) {
                    const distSq = entityPos.distanceToSquared(posVec);
                    // Use horizontal distance check (ignore Y) with generous radius
                    const dx = entityPos.x - posVec.x;
                    const dz = entityPos.z - posVec.z;
                    const horizDistSq = dx * dx + dz * dz;
                    if (horizDistSq < 4.0) { // 2 units radius
                        console.log('[RootHollow] Flora detected via position fallback, absorbing');
                        removeEntity(entity.id);
                        setStatus('CHARGING');
                        setSwarmVisible(true);
                        setSwarmDissipating(false);
                        return;
                    }
                }
                continue;
            }

            const fPos = body.translation();
            // Use horizontal distance primarily (flora might be at different Y due to physics)
            const dx = fPos.x - posVec.x;
            const dz = fPos.z - posVec.z;
            const horizDistSq = dx * dx + dz * dz;

            if (horizDistSq < 4.0) { // 2 units horizontal radius
                const vel = body.linvel();
                const velSq = vel.x ** 2 + vel.y ** 2 + vel.z ** 2;
                // More lenient velocity check - flora might still be settling
                if (velSq < 0.5) {
                    console.log('[RootHollow] Flora detected via physics body, absorbing');
                    removeEntity(entity.id);
                    setStatus('CHARGING');
                    setSwarmVisible(true);
                    setSwarmDissipating(false);
                    return;
                }
            }
        }
    });

    const stumpHeight = STUMP_CONFIG.height * STUMP_CONFIG.scale;
    const stumpRadius = 1.4 * STUMP_CONFIG.scale;

    const groupPosition = useMemo(
        () => new THREE.Vector3(position[0], position[1] - STUMP_CONFIG.embedOffset, position[2]),
        [position]
    );

    const treeWorldPosition = useMemo(() => {
        // Tree grows from ground level (y=0 in local space of the stump group)
        // The stump group is already embedded, so y=0 is at terrain surface
        return new THREE.Vector3(0, 0, 0).applyQuaternion(quaternion).add(groupPosition);
    }, [quaternion, groupPosition]);

    return (
        <group position={groupPosition} quaternion={quaternion}>
            {/* 
               The STUMP MESH itself is now rendered by StumpLayer.tsx 
               using an instancedMesh. We only keep the logic and 
               interactive layers here to save memory.
            */}
            <RigidBody type="fixed" colliders={false}>
                <group position={[0, stumpHeight / 2, 0]}>
                    <CylinderCollider args={[stumpHeight / 2, stumpRadius * 0.6]} />
                </group>
                {/* Visual mesh removed from here - rendered by VoxelTerrain->StumpLayer */}
            </RigidBody>

            {/* Blue flora fireflies - visible before tree grows */}
            {status !== 'GROWING' && (
                <group position={[0, 0.8, 0]}>
                    <HollowFireflies
                        count={3}
                        radius={1.8}
                        heightRange={[0.3, 1.5]}
                        seed={Math.abs(position[0] * 31 + position[2] * 17)}
                    />
                </group>
            )}

            {swarmVisible && (
                <group position={[0, 1.5, 0]}>
                    <Suspense fallback={
                        <mesh>
                            <sphereGeometry args={[0.5, 16, 16]} />
                            <meshStandardMaterial
                                emissive="#ff00ff"
                                emissiveIntensity={5.0}
                                toneMapped={false}
                                color="#ff00ff"
                            />
                        </mesh>
                    }>
                        <LumaSwarm dissipating={swarmDissipating} />
                    </Suspense>
                </group>
            )}

            {(status === 'CHARGING' || status === 'GROWING') && (
                <FractalTree
                    seed={Math.abs(position[0] * 31 + position[2] * 17)}
                    position={new THREE.Vector3(0, 0, 0)}
                    baseRadius={stumpRadius * 0.7}
                    userData={{ type: 'flora_tree' }}
                    orientation={quaternion}
                    worldPosition={treeWorldPosition}
                    worldQuaternion={quaternion}
                    active={status === 'GROWING'}
                    visible={status === 'GROWING'}
                />
            )}
        </group>
    );
};

useGLTF.preload(stumpUrl);
