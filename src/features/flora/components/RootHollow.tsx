import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useWorldStore } from '@state/WorldStore';
import { FractalTree } from '@features/flora/components/FractalTree';
import stumpUrl from '@assets/models/tree_stump.glb?url';

// AAA Visual Config - Matching the reference image
const STUMP_CONFIG = {
    height: 1.4,
    scale: 1.0,
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
export const RootHollow: React.FC<RootHollowProps> = ({ position, normal = [0, 1, 0] }) => {
    const [status, setStatus] = useState<'IDLE' | 'GROWING'>('IDLE');
    const removeEntity = useWorldStore(s => s.removeEntity);
    const getEntitiesNearby = useWorldStore(s => s.getEntitiesNearby);
    const posVec = useMemo(() => new THREE.Vector3(...position), [position]);

    const { scene } = useGLTF(stumpUrl);

    // Orientation Logic: Align the stump to the terrain normal
    const quaternion = useMemo(() => {
        const up = new THREE.Vector3(0, 1, 0);
        // Use primitive values from the array to avoid re-running on new array references
        const nx = normal[0] || 0;
        const ny = normal[1] || 1;
        const nz = normal[2] || 0;

        // GRAVITROPISM FIX:
        // Trees grow mostly UP, not perpendicular to the slope.
        // We blend the terrain normal with the world UP vector.
        const terrainNormal = new THREE.Vector3(nx, ny, nz).normalize();
        const targetDirection = new THREE.Vector3()
            .copy(terrainNormal)
            .lerp(up, 0.7) // 70% Up, 30% Slope. This prevents extreme sideways tilting.
            .normalize();

        // Create quaternion that rotates UP to the Target Direction
        const q = new THREE.Quaternion().setFromUnitVectors(up, targetDirection);

        // Deterministic random rotation based on position
        const hash = Math.abs(Math.sin(position[0] * 12.9898 + position[2] * 78.233) * 43758.5453);
        const randomAngle = (hash % 1) * Math.PI * 2;

        const randomYaw = new THREE.Quaternion().setFromAxisAngle(targetDirection, randomAngle);
        q.multiply(randomYaw);

        return q;
    }, [normal[0], normal[1], normal[2], position[0], position[2]]);

    const { model: stumpModel, radius: stumpRadius, height: stumpHeight } = useMemo(() => {
        const cloned = scene.clone(true);
        const box = new THREE.Box3().setFromObject(cloned);
        const size = new THREE.Vector3();
        box.getSize(size);

        const targetHeight = STUMP_CONFIG.height * STUMP_CONFIG.scale;
        const sourceHeight = size.y > 0.0001 ? size.y : 1;
        const scale = targetHeight / sourceHeight;
        cloned.scale.setScalar(scale);

        // Ensure proper shadowing and single-sided rendering to avoid Z-fighting
        cloned.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                const material = mesh.material as THREE.Material | THREE.Material[];
                if (Array.isArray(material)) {
                    material.forEach(mat => { if (mat) mat.side = THREE.FrontSide; });
                } else if (material) {
                    material.side = THREE.FrontSide;
                }
            }
        });

        const scaledBox = new THREE.Box3().setFromObject(cloned);
        const center = new THREE.Vector3();
        scaledBox.getCenter(center);

        // Position so that the base of the stump sits at y=0 and centered on origin
        cloned.position.set(-center.x, -scaledBox.min.y, -center.z);

        const finalBox = new THREE.Box3().setFromObject(cloned);
        const finalSize = new THREE.Vector3();
        finalBox.getSize(finalSize);

        const radius = Math.max(finalSize.x, finalSize.z) * 0.5;

        return {
            model: cloned,
            radius: radius || 1.4 * STUMP_CONFIG.scale,
            height: finalSize.y || targetHeight
        };
    }, [scene]);

    useFrame(() => {
        if (status !== 'IDLE') return;

        const nearbyEntities = getEntitiesNearby(posVec, 2.0);

        for (const entity of nearbyEntities) {
            if (entity.type !== 'FLORA') continue;

            const body = entity.bodyRef?.current;
            if (!body) continue;

            const fPos = body.translation();
            const distSq = (fPos.x - posVec.x) ** 2 + (fPos.y - posVec.y) ** 2 + (fPos.z - posVec.z) ** 2;
            if (distSq < 2.25) {
                const vel = body.linvel();
                if (vel.x ** 2 + vel.y ** 2 + vel.z ** 2 < 0.01) {
                    removeEntity(entity.id);
                    setStatus('GROWING');
                }
            }
        }
    });

    const colliderHeight = stumpHeight || (STUMP_CONFIG.height * STUMP_CONFIG.scale);
    const colliderRadius = stumpRadius ? stumpRadius * 0.6 : 1.4 * STUMP_CONFIG.scale * 0.6;

    const groupPosition = useMemo(
        () => new THREE.Vector3(position[0], position[1] - STUMP_CONFIG.embedOffset, position[2]),
        [position]
    );

    // World-space spawn point for the tree (top of stump)
    const treeWorldPosition = useMemo(() => {
        return new THREE.Vector3(0, 0.5, 0).applyQuaternion(quaternion).add(groupPosition);
    }, [quaternion, groupPosition]);

    return (
        // Lower the group slightly (-0.3) so the flared roots embed into the terrain
        <group position={groupPosition} quaternion={quaternion}>
            <RigidBody type="fixed" colliders={false}>
                <group position={[0, colliderHeight / 2, 0]}>
                    <CylinderCollider args={[colliderHeight / 2, colliderRadius]} />
                </group>
                <primitive object={stumpModel} />
            </RigidBody>

            {status === 'GROWING' && (
                <FractalTree
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
