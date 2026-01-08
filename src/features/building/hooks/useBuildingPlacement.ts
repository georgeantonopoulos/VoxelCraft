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
const GROUND_PENETRATION = 0.15; // How deep logs are "planted" into ground (like fence posts)
const GRID_SNAP = 0.25; // Snap positions to grid (smoother placement)

// For horizontal roof beam detection
const SUPPORT_TOLERANCE = 0.8; // How close log length must match support gap (increased for flexibility)
const SUPPORT_HEIGHT_TOLERANCE = 0.5; // Y position tolerance for supports

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
    // Select carriedLog directly so Zustand properly tracks changes
    const carriedLog = useCarryingStore(state => state.carriedLog);
    const isCarrying = carriedLog !== null;

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

        // Raycast from camera
        rayOrigin.current.copy(camera.position);
        rayDirection.current.set(0, 0, -1).applyQuaternion(camera.quaternion);

        const ray = new rapier.Ray(rayOrigin.current, rayDirection.current);

        // Cast ray for TERRAIN (ground placement)
        const terrainHit = world.castRay(ray, PLACEMENT_DISTANCE, true, undefined, undefined, undefined, undefined, (collider) => {
            const userData = collider.parent()?.userData as { type?: string } | undefined;
            return userData?.type === 'terrain';
        });

        // Cast ray for PLACED LOGS (stacking placement)
        // Log colliders should have userData.type === 'log'
        const logHit = world.castRay(ray, PLACEMENT_DISTANCE, true, undefined, undefined, undefined, undefined, (collider) => {
            const userData = collider.parent()?.userData as { type?: string } | undefined;
            return userData?.type === 'log';
        });

        // Determine which hit to use - prefer log hit for stacking if it's closer or terrain not hit
        let effectiveHit = terrainHit;
        let hitLog: LogData | null = null;

        if (logHit && logHit.collider) {
            const logHitPoint = rayOrigin.current.clone().addScaledVector(rayDirection.current, logHit.timeOfImpact);
            // Find which placed log was hit
            const hitLogData = placedLogs.find(log => {
                if (!log.isPlaced || !(log.isVertical ?? true)) return false;
                // Check if hit point is near the top of this log
                const logTop = log.position.y + LOG_LENGTH / 2;
                const distXZ = Math.sqrt(
                    Math.pow(logHitPoint.x - log.position.x, 2) +
                    Math.pow(logHitPoint.z - log.position.z, 2)
                );
                // Hit is on this log if within radius and near top
                return distXZ < LOG_RADIUS * 2 && Math.abs(logHitPoint.y - logTop) < LOG_RADIUS * 2;
            });

            if (hitLogData) {
                hitLog = hitLogData;
                // Use log hit if terrain wasn't hit or log is closer
                if (!terrainHit || logHit.timeOfImpact < terrainHit.timeOfImpact) {
                    effectiveHit = logHit;
                }
            }
        }

        if (effectiveHit && effectiveHit.collider) {
            // Calculate hit point
            hitPoint.current.copy(rayOrigin.current).addScaledVector(rayDirection.current, effectiveHit.timeOfImpact);

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

            // Determine final orientation:
            // - User toggle (preferHorizontal) ALWAYS controls the visual preview
            // - Validity (green/red) is determined separately by validatePlacement
            // - This ensures the user sees what they're trying to place, even if invalid
            const useHorizontal = preferHorizontal;

            // Calculate placement position based on orientation
            let finalPosition: THREE.Vector3;
            let finalRotation: THREE.Euler;
            let isStacking = false;

            if (useHorizontal) {
                if (horizontalSupports) {
                    // Horizontal roof beam placement - aligned with supports
                    const { position, rotation } = calculateHorizontalPlacement(horizontalSupports);
                    finalPosition = position;
                    finalRotation = rotation;
                } else {
                    // Horizontal placement without supports - use camera direction
                    // Will show as RED (invalid) but still shows user what they're trying to do
                    const { position, rotation } = calculateHorizontalPlacementFreeform(
                        hitPoint.current,
                        yRotation
                    );
                    finalPosition = position;
                    finalRotation = rotation;
                }
            } else if (hitLog) {
                // Direct stacking on hit log - user is looking at the top of a placed log
                finalPosition = new THREE.Vector3(
                    hitLog.position.x,
                    hitLog.position.y + LOG_LENGTH + VERTICAL_STACK_GAP,
                    hitLog.position.z
                );
                finalRotation = new THREE.Euler(0, yRotation, 0);
                isStacking = true;
            } else {
                // Vertical placement (default)
                const { position, rotation, stacking } = calculateVerticalPlacement(
                    hitPoint.current,
                    yRotation,
                    nearbyLogs,
                    placedLogs
                );
                finalPosition = position;
                finalRotation = rotation;
                isStacking = stacking;
            }

            // Validate placement - pass stacking/bridging flags to allow elevated placements
            const isValid = validatePlacement(
                finalPosition,
                !useHorizontal,
                world,
                rapier,
                isStacking,
                useHorizontal && horizontalSupports !== null
            );

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
            // No hit - hide preview
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
): { position: THREE.Vector3; rotation: THREE.Euler; stacking: boolean } {
    // For vertical log, center is at half the log length above hit point
    // Subtract GROUND_PENETRATION so logs are "planted" into the ground like fence posts
    const baseY = hitPoint.y + LOG_LENGTH / 2 - GROUND_PENETRATION;

    // Snap X/Z to grid for cleaner placement
    let placementX = Math.round(hitPoint.x / GRID_SNAP) * GRID_SNAP;
    let placementZ = Math.round(hitPoint.z / GRID_SNAP) * GRID_SNAP;
    let placementY = baseY;
    let isStacking = false;

    // Check for vertical stacking FIRST (placing on top of existing vertical log)
    // Use the cursor hit point for detection, not the snapped position
    const stackTarget = findStackTarget(
        hitPoint,
        allLogs.filter(l => l.isPlaced && (l.isVertical ?? true))
    );

    if (stackTarget) {
        // Stack on top of existing vertical log
        // Align perfectly with the log below
        placementX = stackTarget.position.x;
        placementZ = stackTarget.position.z;
        // New log center = old log center + full log length + small gap
        placementY = stackTarget.position.y + LOG_LENGTH + VERTICAL_STACK_GAP;
        isStacking = true;
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
        rotation: new THREE.Euler(0, yRotation, 0), // Vertical: Y-axis aligned
        stacking: isStacking
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
    _facingAngle: number
): { log1: LogData; log2: LogData } | null {
    // Get vertical placed logs only
    const verticalLogs = allLogs.filter(l => l.isPlaced && (l.isVertical ?? true));
    if (verticalLogs.length < 2) return null;

    // Find pairs of logs that could support a beam
    let bestPair: { log1: LogData; log2: LogData; dist: number } | null = null;

    for (let i = 0; i < verticalLogs.length; i++) {
        for (let j = i + 1; j < verticalLogs.length; j++) {
            const log1 = verticalLogs[i];
            const log2 = verticalLogs[j];

            // Check if they're at similar heights (within tolerance)
            const yDiff = Math.abs(log1.position.y - log2.position.y);
            if (yDiff > SUPPORT_HEIGHT_TOLERANCE) continue;

            // Check distance between log centers
            const dx = log2.position.x - log1.position.x;
            const dz = log2.position.z - log1.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Gap between supports (subtracting their diameters)
            const gap = dist - LOG_DIAMETER;

            // Gap should be close to LOG_LENGTH for a beam to fit
            if (Math.abs(gap - LOG_LENGTH) > SUPPORT_TOLERANCE) continue;

            // Check if cursor is near the XZ midpoint between these logs
            // (ignore Y - we might be looking at the ground or sky)
            const midpointX = (log1.position.x + log2.position.x) / 2;
            const midpointZ = (log1.position.z + log2.position.z) / 2;

            const distXZ = Math.sqrt(
                Math.pow(hitPoint.x - midpointX, 2) +
                Math.pow(hitPoint.z - midpointZ, 2)
            );

            // Must be within the beam length to be considered "looking at" this pair
            if (distXZ < LOG_LENGTH * 1.5) {
                // Track the closest pair to cursor
                if (!bestPair || distXZ < bestPair.dist) {
                    bestPair = { log1, log2, dist: distXZ };
                }
            }
        }
    }

    return bestPair ? { log1: bestPair.log1, log2: bestPair.log2 } : null;
}

/**
 * Calculate horizontal beam placement between two supports
 *
 * The cylinder's default axis is Y (vertical). To lay it horizontally
 * along the line connecting two vertical supports, we need to rotate
 * the Y-axis to point along the support line direction.
 */
function calculateHorizontalPlacement(
    supports: { log1: LogData; log2: LogData }
): { position: THREE.Vector3; rotation: THREE.Euler } {
    const { log1, log2 } = supports;

    // Vertical log positions are their CENTER points
    // Top of vertical log = center.y + LOG_LENGTH/2
    // Horizontal log rests on top, so its center = top of vertical + horizontal log's radius
    const verticalLogTop = Math.max(log1.position.y, log2.position.y) + LOG_LENGTH / 2;
    const horizontalLogCenterY = verticalLogTop + LOG_RADIUS;

    const position = new THREE.Vector3(
        (log1.position.x + log2.position.x) / 2,
        horizontalLogCenterY,
        (log1.position.z + log2.position.z) / 2
    );

    // Direction from log1 to log2 (the line the beam should follow)
    const direction = new THREE.Vector3(
        log2.position.x - log1.position.x,
        0,
        log2.position.z - log1.position.z
    ).normalize();

    // CylinderGeometry axis is Y (up). We need to rotate so Y points along 'direction'.
    // Use quaternion to rotate from UP (0,1,0) to the horizontal direction.
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
    const euler = new THREE.Euler().setFromQuaternion(quaternion);

    return {
        position,
        rotation: euler
    };
}

/**
 * Calculate horizontal placement without supports (freeform, follows camera direction)
 * Used when user toggles to horizontal but no valid supports are nearby.
 * This will typically show as RED (invalid) since horizontal logs need support.
 */
function calculateHorizontalPlacementFreeform(
    hitPoint: THREE.Vector3,
    cameraYRotation: number
): { position: THREE.Vector3; rotation: THREE.Euler } {
    // Position at hit point, raised by log radius so it sits on surface
    const position = new THREE.Vector3(
        hitPoint.x,
        hitPoint.y + LOG_RADIUS,
        hitPoint.z
    );

    // Direction perpendicular to camera facing (beam goes left-right relative to view)
    const direction = new THREE.Vector3(
        Math.sin(cameraYRotation + Math.PI / 2),
        0,
        Math.cos(cameraYRotation + Math.PI / 2)
    ).normalize();

    // CylinderGeometry axis is Y (up). Rotate so Y points along 'direction'.
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
    const euler = new THREE.Euler().setFromQuaternion(quaternion);

    return {
        position,
        rotation: euler
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
    rapier: any,
    isStacking: boolean = false,
    hasHorizontalSupports: boolean = false
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

            // Collision with anything except terrain and player invalidates placement
            // Also allow logs (we'll be near them when stacking/bridging)
            if (type !== 'terrain' && type !== 'player' && type !== 'log') {
                hasCollision = true;
                return false; // Stop iteration
            }
            return true;
        }
    );

    // For vertical logs stacking on other logs, we don't need ground below
    if (isVertical && isStacking) {
        return !hasCollision;
    }

    // For horizontal logs bridging supports, we don't need ground below
    if (!isVertical && hasHorizontalSupports) {
        return !hasCollision;
    }

    // For ground-level vertical logs, ensure we're not placing inside terrain
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
