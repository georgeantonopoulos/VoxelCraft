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

    // Use ref to track timer so we can properly clean it up
    const growTimerRef = useRef<NodeJS.Timeout | null>(null);
    const dissipateStartTimerRef = useRef<NodeJS.Timeout | null>(null);
    const dissipateTimerRef = useRef<NodeJS.Timeout | null>(null);

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
    }, [status]);

    const frameCount = useRef(0);
    useFrame((state) => {
        // OPTIMIZATION: Only run scanning if player is nearby (< 10 units)
        const playerDistSq = state.camera.position.distanceToSquared(posVec);
        if (playerDistSq > 100) return; // 10^2 = 100

        if (status !== 'IDLE') return;

        frameCount.current++;
        if (frameCount.current % 20 !== 0) return;

        const nearbyEntities = getEntitiesNearby(posVec, 2.0);

        for (const entity of nearbyEntities) {
            if (entity.type !== ItemType.FLORA) continue;

            const body = entity.bodyRef?.current;
            if (!body) continue;

            const fPos = body.translation();
            const distSq = (fPos.x - posVec.x) ** 2 + (fPos.y - posVec.y) ** 2 + (fPos.z - posVec.z) ** 2;
            if (distSq < 2.25) {
                const vel = body.linvel();
                if (vel.x ** 2 + vel.y ** 2 + vel.z ** 2 < 0.01) {
                    removeEntity(entity.id);
                    setStatus('CHARGING');
                    setSwarmVisible(true);
                    setSwarmDissipating(false);
                }
            }
        }
    });

    const groupPosition = useMemo(
        () => new THREE.Vector3(position[0], position[1] - STUMP_CONFIG.embedOffset, position[2]),
        [position]
    );

    const treeWorldPosition = useMemo(() => {
        return new THREE.Vector3(0, 0.5, 0).applyQuaternion(quaternion).add(groupPosition);
    }, [quaternion, groupPosition]);

    const stumpHeight = STUMP_CONFIG.height * STUMP_CONFIG.scale;
    const stumpRadius = 1.4 * STUMP_CONFIG.scale;

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
                // Prewarm the tree during CHARGING so the worker finishes before GROWING starts.
                // This avoids a visible "gap" where the swarm is present but the tree hasn't generated yet.
                <FractalTree
                    active={status === 'GROWING'}
                    visible={status === 'GROWING'}
                    seed={Math.abs(position[0] * 31 + position[2] * 17)}
                    position={new THREE.Vector3(0, 0.5, 0)}
                    baseRadius={stumpRadius}
                    userData={{ type: 'flora_tree' }}
                    orientation={quaternion}
                    worldPosition={treeWorldPosition}
                    worldQuaternion={quaternion}
                />
            )}
        </group>
    );
};

useGLTF.preload(stumpUrl);
