import React, { useMemo } from 'react';
import * as THREE from 'three';

// Ghost log dimensions match actual Log dimensions
const LOG_LENGTH = 2.0;
const LOG_RADIUS = 0.25;

export interface GhostLogProps {
    /** World position for the ghost log preview */
    position: THREE.Vector3;
    /** Rotation in euler angles */
    rotation: THREE.Euler;
    /** Whether the placement is valid (affects color) */
    isValid: boolean;
    /** Whether the ghost log should be visible */
    visible: boolean;
}

/**
 * GhostLog - Semi-transparent preview for log placement.
 * Shows green when valid placement, red when invalid.
 * Uses wireframe + transparent solid for clear visibility.
 */
export const GhostLog: React.FC<GhostLogProps> = ({
    position,
    rotation,
    isValid,
    visible
}) => {
    // Materials for valid/invalid states
    const solidMaterial = useMemo(() => {
        return new THREE.MeshBasicMaterial({
            color: isValid ? 0x00ff00 : 0xff0000,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
        });
    }, [isValid]);

    const wireMaterial = useMemo(() => {
        return new THREE.MeshBasicMaterial({
            color: isValid ? 0x00ff00 : 0xff0000,
            wireframe: true,
            transparent: true,
            opacity: 0.6,
        });
    }, [isValid]);

    if (!visible) return null;

    return (
        <group position={position} rotation={rotation}>
            {/* Solid semi-transparent cylinder */}
            <mesh material={solidMaterial} renderOrder={999}>
                <cylinderGeometry args={[LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 12]} />
            </mesh>
            {/* Wireframe overlay for clarity */}
            <mesh material={wireMaterial} renderOrder={1000}>
                <cylinderGeometry args={[LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 8]} />
            </mesh>
            {/* End cap indicators */}
            <mesh position={[0, LOG_LENGTH / 2, 0]} material={wireMaterial} renderOrder={1000}>
                <circleGeometry args={[LOG_RADIUS, 8]} />
            </mesh>
            <mesh position={[0, -LOG_LENGTH / 2, 0]} rotation={[Math.PI, 0, 0]} material={wireMaterial} renderOrder={1000}>
                <circleGeometry args={[LOG_RADIUS, 8]} />
            </mesh>
        </group>
    );
};

export default GhostLog;
