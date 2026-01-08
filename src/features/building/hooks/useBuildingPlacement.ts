import { useCallback, useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { useCarryingStore } from '@/state/CarryingStore';

// Log dimensions (must match Log.tsx)
const LOG_LENGTH = 2.0;
const LOG_RADIUS = 0.25;
const LOG_DIAMETER = LOG_RADIUS * 2;

// Placement constants
const PLACEMENT_DISTANCE = 4.0; // Max distance to place a log
const VERTICAL_STACK_GAP = 0.05; // Small gap between stacked logs
const ADJACENT_GAP = 0.08; // Gap between adjacent logs for walls
const MIN_GROUND_CLEARANCE = 0.1; // Minimum height above ground
const GRID_SNAP = 0.25; // Snap positions to grid (smoother placement)

// For horizontal roof beam detection
const SUPPORT_TOLERANCE = 0.3; // How close log length must match support gap
const SUPPORT_HEIGHT_TOLERANCE = 0.2; // Y position tolerance for supports

export interface PlacementState {
    /** World position for placement preview */
    position: THREE.Vector3;
    /** Rotation for placement (euler) */
    rotation: THREE.Euler;
    /** Whether the current placement is valid */
    isValid: boolean;
    /** Whether we should show the ghost preview */
    showPreview: boolean;
    /** Whether the log will be placed vertically */
    isVertical: boolean;
    /** Whether horizontal placement is available (for UI feedback) */
    canBeHorizontal: boolean;
    /** Nearby placed logs for snapping */
    nearbyLogs: Array<{ id: string; position: THREE.Vector3; isVertical: boolean }>;
}

export interface PlacementResult {
    success: boolean;
    position?: THREE.Vector3;
    rotation?: THREE.Euler;
    isVertical?: boolean;
}

export interface LogData {
    id: string;
    position: THREE.Vector3;
    isPlaced: boolean;
    isVertical?: boolean;
}

/**
 * useBuildingPlacement - Hook for managing vertical-first log placement.
 *
 * Features:
 * - VERTICAL placement by default (fence post style)
 * - Vertical stacking for building walls upward
 * - Adjacent vertical placement for wall extension
 * - HORIZONTAL only when bridging gap between two vertical supports (roof beams)
 * - Mouse wheel toggles between vertical/horizontal when both are valid
 */
export function useBuildingPlacement(placedLogs: LogData[]) {
    const { camera } = useThree();
    const { world, rapier } = useRapier();
    const isCarrying = useCarryingStore(state => state.isCarrying());

    // User preference for orientation (toggled by mouse wheel)
    const [preferHorizontal, setPreferHorizontal] = useState(false);

    // Placement state
    const [placementState, setPlacementState] = useState<PlacementState>({
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(0, 0, 0), // Vertical by default (Y-axis aligned)
        isValid: false,
        showPreview: false,
        isVertical: true,
        canBeHorizontal: false,
        nearbyLogs: []
    });

    // Refs for raycast reuse
    const rayOrigin = useRef(new THREE.Vector3());
    const rayDirection = useRef(new THREE.Vector3());
    const hitPoint = useRef(new THREE.Vector3());

    // Listen for rotation toggle events from mouse wheel
    useEffect(() => {
        const handleRotationToggle = () => {
            setPreferHorizontal(prev => !prev);
        };

        window.addEventListener('vc-building-rotation-toggle', handleRotationToggle);
        return () => window.removeEventListener('vc-building-rotation-toggle', handleRotationToggle);
    }, []);

    // Reset preference when starting to carry a new log
    useEffect(() => {
        if (isCarrying) {
            setPreferHorizontal(false); // Always start with vertical
        }
    }, [isCarrying]);

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

            // Get camera facing direction for Y rotation
            const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            cameraForward.y = 0;
            cameraForward.normalize();
            const yRotation = Math.atan2(cameraForward.x, cameraForward.z);

            // Find nearby placed logs
            const nearbyLogs = findNearbyPlacedLogs(hitPoint.current, placedLogs, LOG_LENGTH * 2);

            // Check if horizontal placement is possible (two vertical supports)
            const horizontalSupports = findHorizontalSupports(hitPoint.current, placedLogs, yRotation);
            const canBeHorizontal = horizontalSupports !== null;

            // Determine final orientation based on preference and availability
            const useHorizontal = preferHorizontal && canBeHorizontal;

            // Calculate placement position based on orientation
            let finalPosition: THREE.Vector3;
            let finalRotation: THREE.Euler;

            if (useHorizontal && horizontalSupports) {
                // Horizontal roof beam placement
                const { position, rotation } = calculateHorizontalPlacement(horizontalSupports);
                finalPosition = position;
                finalRotation = rotation;
            } else {
                // Vertical placement (default)
                const { position, rotation } = calculateVerticalPlacement(
                    hitPoint.current,
                    yRotation,
                    nearbyLogs,
                    placedLogs
                );
                finalPosition = position;
                finalRotation = rotation;
            }

            // Validate placement
            const isValid = validatePlacement(finalPosition, !useHorizontal, world, rapier);

            setPlacementState({
                position: finalPosition.clone(),
                rotation: finalRotation.clone(),
                isValid,
                showPreview: true,
                isVertical: !useHorizontal,
                canBeHorizontal,
                nearbyLogs: nearbyLogs.map(log => ({
                    id: log.id,
                    position: log.position.clone(),
                    isVertical: log.isVertical ?? true
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
            rotation: placementState.rotation.clone(),
            isVertical: placementState.isVertical
        };
    }, [placementState]);

    return {
        placementState,
        placeLog
    };
}

/**
 * Calculate vertical placement position with snapping to existing logs
 */
function calculateVerticalPlacement(
    hitPoint: THREE.Vector3,
    yRotation: number,
    nearbyLogs: LogData[],
    allLogs: LogData[]
): { position: THREE.Vector3; rotation: THREE.Euler } {
    // For vertical log, center is at half the log length above hit point
    const baseY = hitPoint.y + LOG_LENGTH / 2 + MIN_GROUND_CLEARANCE;

    // Snap X/Z to grid for cleaner placement
    let placementX = Math.round(hitPoint.x / GRID_SNAP) * GRID_SNAP;
    let placementZ = Math.round(hitPoint.z / GRID_SNAP) * GRID_SNAP;
    let placementY = baseY;

    // Check for vertical stacking (placing on top of existing vertical log)
    const stackTarget = findStackTarget(
        new THREE.Vector3(placementX, hitPoint.y, placementZ),
        allLogs.filter(l => l.isPlaced && (l.isVertical ?? true))
    );

    if (stackTarget) {
        // Stack on top of existing vertical log
        placementX = stackTarget.position.x;
        placementZ = stackTarget.position.z;
        placementY = stackTarget.position.y + LOG_LENGTH + VERTICAL_STACK_GAP;
    } else {
        // Check for adjacent placement (wall building)
        const adjacentTarget = findAdjacentTarget(
            new THREE.Vector3(placementX, placementY, placementZ),
            nearbyLogs.filter(l => l.isVertical ?? true)
        );

        if (adjacentTarget) {
            // Place adjacent to existing log
            const dir = new THREE.Vector3()
                .subVectors(new THREE.Vector3(placementX, 0, placementZ),
                           new THREE.Vector3(adjacentTarget.position.x, 0, adjacentTarget.position.z))
                .normalize();

            placementX = adjacentTarget.position.x + dir.x * (LOG_DIAMETER + ADJACENT_GAP);
            placementZ = adjacentTarget.position.z + dir.z * (LOG_DIAMETER + ADJACENT_GAP);
            // Match the Y level of the adjacent log for consistent wall height
            placementY = adjacentTarget.position.y;
        }
    }

    return {
        position: new THREE.Vector3(placementX, placementY, placementZ),
        rotation: new THREE.Euler(0, yRotation, 0) // Vertical: Y-axis aligned
    };
}

/**
 * Find a vertical log that we can stack on top of
 */
function findStackTarget(
    cursorPos: THREE.Vector3,
    verticalLogs: LogData[]
): LogData | null {
    const STACK_XZ_TOLERANCE = LOG_RADIUS * 1.5;

    let bestTarget: LogData | null = null;
    let bestDistSq = STACK_XZ_TOLERANCE * STACK_XZ_TOLERANCE;

    for (const log of verticalLogs) {
        // Check XZ distance (must be nearly aligned)
        const dxz = Math.sqrt(
            Math.pow(cursorPos.x - log.position.x, 2) +
            Math.pow(cursorPos.z - log.position.z, 2)
        );

        if (dxz > STACK_XZ_TOLERANCE) continue;

        // Check if cursor is above this log's top
        const logTop = log.position.y + LOG_LENGTH / 2;
        if (cursorPos.y < logTop - 0.5) continue; // Must be near or above top

        const distSq = dxz * dxz;
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestTarget = log;
        }
    }

    return bestTarget;
}

/**
 * Find an adjacent vertical log for wall extension
 */
function findAdjacentTarget(
    cursorPos: THREE.Vector3,
    verticalLogs: LogData[]
): LogData | null {
    const ADJACENT_DISTANCE = LOG_DIAMETER * 3; // Max distance to consider adjacent

    let bestTarget: LogData | null = null;
    let bestDist = ADJACENT_DISTANCE;

    for (const log of verticalLogs) {
        // Check horizontal distance
        const dx = cursorPos.x - log.position.x;
        const dz = cursorPos.z - log.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Must be close but not overlapping
        if (dist < LOG_DIAMETER * 1.5 || dist > ADJACENT_DISTANCE) continue;

        // Prefer closer logs
        if (dist < bestDist) {
            bestDist = dist;
            bestTarget = log;
        }
    }

    return bestTarget;
}

/**
 * Find two vertical support logs that could support a horizontal roof beam
 */
function findHorizontalSupports(
    hitPoint: THREE.Vector3,
    allLogs: LogData[],
    facingAngle: number
): { log1: LogData; log2: LogData } | null {
    // Get vertical placed logs only
    const verticalLogs = allLogs.filter(l => l.isPlaced && (l.isVertical ?? true));
    if (verticalLogs.length < 2) return null;

    // Direction perpendicular to facing (for beam orientation)
    const beamDir = new THREE.Vector3(
        Math.sin(facingAngle + Math.PI / 2),
        0,
        Math.cos(facingAngle + Math.PI / 2)
    );

    // Find pairs of logs that could support a beam
    for (let i = 0; i < verticalLogs.length; i++) {
        for (let j = i + 1; j < verticalLogs.length; j++) {
            const log1 = verticalLogs[i];
            const log2 = verticalLogs[j];

            // Check if they're at similar heights
            const yDiff = Math.abs(log1.position.y - log2.position.y);
            if (yDiff > SUPPORT_HEIGHT_TOLERANCE) continue;

            // Check distance between logs (should be close to LOG_LENGTH)
            const dx = log2.position.x - log1.position.x;
            const dz = log2.position.z - log1.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Gap between supports (subtracting their radii)
            const gap = dist - LOG_DIAMETER;

            // Gap should be close to LOG_LENGTH for a beam to fit
            if (Math.abs(gap - LOG_LENGTH) > SUPPORT_TOLERANCE) continue;

            // Check if cursor is near the line between these logs
            const midpoint = new THREE.Vector3(
                (log1.position.x + log2.position.x) / 2,
                Math.max(log1.position.y, log2.position.y) + LOG_LENGTH / 2,
                (log1.position.z + log2.position.z) / 2
            );

            const distToMidpoint = hitPoint.distanceTo(midpoint);
            if (distToMidpoint < LOG_LENGTH) {
                return { log1, log2 };
            }
        }
    }

    return null;
}

/**
 * Calculate horizontal beam placement between two supports
 */
function calculateHorizontalPlacement(
    supports: { log1: LogData; log2: LogData }
): { position: THREE.Vector3; rotation: THREE.Euler } {
    const { log1, log2 } = supports;

    // Position at midpoint between supports, on top of them
    const topY = Math.max(log1.position.y, log2.position.y) + LOG_LENGTH / 2;
    const position = new THREE.Vector3(
        (log1.position.x + log2.position.x) / 2,
        topY + LOG_RADIUS + VERTICAL_STACK_GAP,
        (log1.position.z + log2.position.z) / 2
    );

    // Rotation to point from log1 to log2
    const dx = log2.position.x - log1.position.x;
    const dz = log2.position.z - log1.position.z;
    const yRotation = Math.atan2(dx, dz);

    // Horizontal: rotate 90 degrees around X or Z to lay flat
    // CylinderGeometry axis is Y, so rotation [0, yRot, PI/2] lays it horizontal
    return {
        position,
        rotation: new THREE.Euler(0, yRotation, Math.PI / 2)
    };
}

/**
 * Find placed logs within a certain radius
 */
function findNearbyPlacedLogs(
    position: THREE.Vector3,
    allLogs: LogData[],
    radius: number
): LogData[] {
    const radiusSq = radius * radius;
    return allLogs.filter(log =>
        log.isPlaced &&
        position.distanceToSquared(log.position) < radiusSq
    );
}

/**
 * Validate that the placement doesn't intersect with other objects
 */
function validatePlacement(
    position: THREE.Vector3,
    isVertical: boolean,
    world: any,
    rapier: any
): boolean {
    // Use a capsule/sphere test at the placement position
    const testRadius = LOG_RADIUS * 0.8;

    let hasCollision = false;

    world.intersectionsWithShape(
        position,
        { x: 0, y: 0, z: 0, w: 1 },
        new rapier.Ball(testRadius),
        (collider: any) => {
            const userData = collider.parent()?.userData as { type?: string } | undefined;
            const type = userData?.type;

            // Collision with anything except terrain invalidates placement
            if (type !== 'terrain' && type !== 'player') {
                hasCollision = true;
                return false; // Stop iteration
            }
            return true;
        }
    );

    // For vertical logs, ensure we're not placing inside terrain
    if (isVertical) {
        const downRay = new rapier.Ray(position, { x: 0, y: -1, z: 0 });
        const downHit = world.castRay(downRay, LOG_LENGTH, true, undefined, undefined, undefined, undefined, (collider: any) => {
            return collider.parent()?.userData?.type === 'terrain';
        });

        // Valid if ground is found below
        return !hasCollision && downHit !== null;
    }

    return !hasCollision;
}

export default useBuildingPlacement;
