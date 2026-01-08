import { useCallback, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { useCarryingStore } from '@/state/CarryingStore';

// Log dimensions (must match Log.tsx)
const LOG_LENGTH = 2.0;
const LOG_RADIUS = 0.25;

// Placement constants
const PLACEMENT_DISTANCE = 4.0; // Max distance to place a log
const SNAP_DISTANCE = 0.5; // Distance to snap to adjacent logs
const MIN_GROUND_CLEARANCE = 0.1; // Minimum height above ground
const GRID_SNAP = 0.25; // Snap positions to grid (smoother placement)

export interface PlacementState {
    /** World position for placement preview */
    position: THREE.Vector3;
    /** Rotation for placement (euler) */
    rotation: THREE.Euler;
    /** Whether the current placement is valid */
    isValid: boolean;
    /** Whether we should show the ghost preview */
    showPreview: boolean;
    /** Nearby placed logs for snapping (future feature) */
    nearbyLogs: Array<{ id: string; position: THREE.Vector3; rotation: THREE.Euler }>;
}

export interface PlacementResult {
    success: boolean;
    position?: THREE.Vector3;
    rotation?: THREE.Euler;
}

/**
 * useBuildingPlacement - Hook for managing log placement preview and validation.
 *
 * Features:
 * - Raycasts against terrain to find placement position
 * - Shows ghost preview when carrying a log
 * - Validates placement (minimum clearance, terrain intersection)
 * - Returns placement position/rotation on right-click
 */
export function useBuildingPlacement(placedLogs: Array<{ id: string; position: THREE.Vector3; isPlaced: boolean }>) {
    const { camera } = useThree();
    const { world, rapier } = useRapier();
    const isCarrying = useCarryingStore(state => state.isCarrying());

    // Placement state
    const [placementState, setPlacementState] = useState<PlacementState>({
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(0, 0, Math.PI / 2), // Horizontal by default
        isValid: false,
        showPreview: false,
        nearbyLogs: []
    });

    // Refs for raycast reuse
    const rayOrigin = useRef(new THREE.Vector3());
    const rayDirection = useRef(new THREE.Vector3());
    const hitPoint = useRef(new THREE.Vector3());
    const hitNormal = useRef(new THREE.Vector3());

    // Update placement preview every frame when carrying
    useFrame(() => {
        if (!isCarrying) {
            if (placementState.showPreview) {
                setPlacementState(prev => ({ ...prev, showPreview: false, isValid: false }));
            }
            return;
        }

        // Raycast from camera to find terrain hit point
        rayOrigin.current.copy(camera.position);
        rayDirection.current.set(0, 0, -1).applyQuaternion(camera.quaternion);

        const ray = new rapier.Ray(rayOrigin.current, rayDirection.current);

        // Cast ray looking for terrain (exclude player, logs, physics items)
        const hit = world.castRay(ray, PLACEMENT_DISTANCE, true, undefined, undefined, undefined, undefined, (collider) => {
            const userData = collider.parent()?.userData as { type?: string } | undefined;
            const type = userData?.type;
            // Only hit terrain, exclude player, logs, and physics items
            return type === 'terrain';
        });

        if (hit && hit.collider) {
            // Calculate hit point
            hitPoint.current.copy(rayOrigin.current).addScaledVector(rayDirection.current, hit.timeOfImpact);

            // Get surface normal from the shape (approximate - use up vector for flat placement)
            // For now, assume placement on relatively flat surfaces
            hitNormal.current.set(0, 1, 0);

            // Calculate placement position (log center above hit point)
            // Log is horizontal, so we offset by radius + clearance
            const placementY = hitPoint.current.y + LOG_RADIUS + MIN_GROUND_CLEARANCE;

            // Snap to grid for cleaner placement
            const placementX = Math.round(hitPoint.current.x / GRID_SNAP) * GRID_SNAP;
            const placementZ = Math.round(hitPoint.current.z / GRID_SNAP) * GRID_SNAP;

            // Calculate rotation - log lies along the camera's horizontal direction
            const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            cameraForward.y = 0;
            cameraForward.normalize();

            // Log rotation: roll it to be horizontal (Z-axis rotation), then face camera direction
            const yRotation = Math.atan2(cameraForward.x, cameraForward.z);

            // Find nearby placed logs for potential snapping
            const nearbyLogs = findNearbyPlacedLogs(
                new THREE.Vector3(placementX, placementY, placementZ),
                placedLogs,
                SNAP_DISTANCE * 4
            );

            // Check for snap points with nearby placed logs
            const snapResult = checkSnapPoints(
                new THREE.Vector3(placementX, placementY, placementZ),
                yRotation,
                nearbyLogs
            );

            // Validate placement (check for collision with existing objects)
            const isValid = validatePlacement(
                snapResult.position,
                snapResult.rotation,
                world,
                rapier
            );

            setPlacementState({
                position: snapResult.position.clone(),
                rotation: new THREE.Euler(0, snapResult.rotation, Math.PI / 2),
                isValid,
                showPreview: true,
                nearbyLogs: nearbyLogs.map(log => ({
                    id: log.id,
                    position: log.position.clone(),
                    rotation: new THREE.Euler(0, 0, Math.PI / 2)
                }))
            });
        } else {
            // No terrain hit - hide preview
            if (placementState.showPreview) {
                setPlacementState(prev => ({ ...prev, showPreview: false, isValid: false }));
            }
        }
    });

    // Place log at current preview position
    const placeLog = useCallback((): PlacementResult => {
        if (!placementState.isValid || !placementState.showPreview) {
            return { success: false };
        }

        return {
            success: true,
            position: placementState.position.clone(),
            rotation: placementState.rotation.clone()
        };
    }, [placementState]);

    return {
        placementState,
        placeLog
    };
}

/**
 * Find placed logs within a certain radius for snapping
 */
function findNearbyPlacedLogs(
    position: THREE.Vector3,
    allLogs: Array<{ id: string; position: THREE.Vector3; isPlaced: boolean }>,
    radius: number
): Array<{ id: string; position: THREE.Vector3 }> {
    const radiusSq = radius * radius;
    return allLogs
        .filter(log => log.isPlaced && position.distanceToSquared(log.position) < radiusSq)
        .map(log => ({ id: log.id, position: log.position }));
}

/**
 * Check for snap points with nearby placed logs.
 * Returns adjusted position and rotation if snapping is appropriate.
 */
function checkSnapPoints(
    position: THREE.Vector3,
    yRotation: number,
    nearbyLogs: Array<{ id: string; position: THREE.Vector3 }>
): { position: THREE.Vector3; rotation: number } {
    if (nearbyLogs.length === 0) {
        return { position, rotation: yRotation };
    }

    // Find the closest placed log
    let closestLog = nearbyLogs[0];
    let closestDistSq = position.distanceToSquared(closestLog.position);

    for (let i = 1; i < nearbyLogs.length; i++) {
        const distSq = position.distanceToSquared(nearbyLogs[i].position);
        if (distSq < closestDistSq) {
            closestDistSq = distSq;
            closestLog = nearbyLogs[i];
        }
    }

    const closestDist = Math.sqrt(closestDistSq);

    // If close enough, snap adjacent (side by side for wall building)
    if (closestDist < SNAP_DISTANCE * 2) {
        // Calculate direction from existing log to new position
        const dir = new THREE.Vector3().subVectors(position, closestLog.position);
        dir.y = 0; // Keep horizontal
        dir.normalize();

        // Snap position: place adjacent with gap equal to 2 * radius
        const snapPos = closestLog.position.clone();
        snapPos.addScaledVector(dir, LOG_RADIUS * 2 + 0.05); // Small gap for visual clarity
        snapPos.y = position.y; // Keep original height

        return { position: snapPos, rotation: yRotation };
    }

    // If slightly further, check for stacking (roof building)
    if (closestDist < SNAP_DISTANCE * 3 && position.y > closestLog.position.y + LOG_RADIUS) {
        // Stacking: place on top
        const stackPos = new THREE.Vector3(
            position.x,
            closestLog.position.y + LOG_RADIUS * 2 + 0.05,
            position.z
        );

        return { position: stackPos, rotation: yRotation };
    }

    return { position, rotation: yRotation };
}

/**
 * Validate that the placement doesn't intersect with other objects.
 * Returns true if placement is valid.
 */
function validatePlacement(
    position: THREE.Vector3,
    _rotation: number,
    world: any,
    rapier: any
): boolean {
    // Use a sphere intersection test at the placement position
    // The sphere radius should be slightly smaller than the log to allow tight fits
    const testRadius = LOG_RADIUS * 0.9;

    let hasCollision = false;

    world.intersectionsWithShape(
        position,
        { x: 0, y: 0, z: 0, w: 1 },
        new rapier.Ball(testRadius),
        (collider: any) => {
            const userData = collider.parent()?.userData as { type?: string } | undefined;
            const type = userData?.type;

            // Collision with anything except terrain invalidates placement
            // (terrain collision is expected and OK)
            if (type !== 'terrain' && type !== 'player') {
                hasCollision = true;
                return false; // Stop iteration
            }
            return true; // Continue checking
        }
    );

    // Also ensure we're not placing inside terrain
    // A simple downward ray should hit terrain within a reasonable distance
    const downRay = new rapier.Ray(position, { x: 0, y: -1, z: 0 });
    const downHit = world.castRay(downRay, LOG_RADIUS + 1.0, true, undefined, undefined, undefined, undefined, (collider: any) => {
        return collider.parent()?.userData?.type === 'terrain';
    });

    // Valid if no collisions and we found ground below
    return !hasCollision && downHit !== null;
}

export default useBuildingPlacement;
