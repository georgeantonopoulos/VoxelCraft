import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { getHollowStumpGeometry } from '@features/flora/trees/hollowStump';
import { getHollowBarkMaterial } from '@features/terrain/components/TreeLayer';

interface StumpLayerProps {
    positions: Float32Array; // Stride 6: x, y, z, nx, ny, nz
    chunkKey: string;
}

/** The instance sits this far below the surface point (RootHollow uses the same offset). */
const EMBED_OFFSET = 0.3;

// The inside of the hollow: darkening toward the floor, where a little Lumina still glows.
let innerMaterial: THREE.MeshStandardMaterial | null = null;
let floorMaterial: THREE.MeshStandardMaterial | null = null;
export const getHollowInteriorMaterials = () => {
    innerMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    floorMaterial ??= new THREE.MeshStandardMaterial({
        color: '#15120e', roughness: 1, metalness: 0,
        emissive: new THREE.Color('#62e6d8'), emissiveIntensity: 0.16,
    });
    return { inner: innerMaterial, floor: floorMaterial };
};

/**
 * Instanced renderer for the dormant Root Hollow stumps: a procedural broken
 * ancient stump in the trees' own bark (see hollowStump.ts), hollow inside.
 */
export const StumpLayer = React.memo(({ positions }: StumpLayerProps) => {
    const barkRef = useRef<THREE.InstancedMesh>(null);
    const innerRef = useRef<THREE.InstancedMesh>(null);
    const floorRef = useRef<THREE.InstancedMesh>(null);
    const geo = useMemo(() => getHollowStumpGeometry(), []);
    const bark = useMemo(() => getHollowBarkMaterial(), []);
    const interior = useMemo(() => getHollowInteriorMaterials(), []);
    const count = positions.length / 6;

    useLayoutEffect(() => {
        const meshes = [barkRef.current, innerRef.current, floorRef.current];
        if (meshes.some((m) => !m) || count === 0) return;
        const dummy = new THREE.Object3D();
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < count; i++) {
            const x = positions[i * 6], y = positions[i * 6 + 1], z = positions[i * 6 + 2];
            const n = new THREE.Vector3(positions[i * 6 + 3], positions[i * 6 + 4], positions[i * 6 + 5]).normalize();
            dummy.position.set(x, y - EMBED_OFFSET, z);
            // Mostly upright, leaning a little with the slope.
            const target = n.lerp(up, 0.7).normalize();
            dummy.quaternion.setFromUnitVectors(up, target);
            const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
            dummy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(up, hash * Math.PI * 2));
            dummy.scale.setScalar(0.94 + 0.14 * ((hash * 7.13) % 1));
            dummy.updateMatrix();
            for (const m of meshes) m!.setMatrixAt(i, dummy.matrix);
        }
        for (const m of meshes) {
            m!.instanceMatrix.needsUpdate = true;
            m!.computeBoundingSphere();
        }
    }, [positions, count]);

    if (count === 0) return null;
    return (
        <group>
            <instancedMesh ref={barkRef} args={[geo.bark, bark, count]} castShadow receiveShadow />
            <instancedMesh ref={innerRef} args={[geo.inner, interior.inner, count]} receiveShadow />
            <instancedMesh ref={floorRef} args={[geo.floor, interior.floor, count]} />
        </group>
    );
});
