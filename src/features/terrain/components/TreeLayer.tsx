import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';

interface TreeLayerProps {
    data: Float32Array; // Stride 4: x, y, z, type
}

export const TreeLayer: React.FC<TreeLayerProps> = React.memo(({ data }) => {
    // Group data by type
    const batches = useMemo(() => {
        const map = new Map<number, { positions: number[], count: number }>();

        for (let i = 0; i < data.length; i += 4) {
            const x = data[i];
            const y = data[i + 1];
            const z = data[i + 2];
            const type = data[i + 3];

            if (!map.has(type)) {
                map.set(type, { positions: [], count: 0 });
            }
            const batch = map.get(type)!;
            batch.positions.push(x, y, z);
            batch.count++;
        }
        return map;
    }, [data]);

    return (
        <group>
            {Array.from(batches.entries()).map(([type, batch]) => (
                <InstancedTreeBatch
                    key={type}
                    type={type}
                    positions={batch.positions}
                    count={batch.count}
                />
            ))}
        </group>
    );
});

const InstancedTreeBatch: React.FC<{ type: number, positions: number[], count: number }> = ({ type, positions, count }) => {
    const woodMesh = useRef<THREE.InstancedMesh>(null);
    const leafMesh = useRef<THREE.InstancedMesh>(null);

    const { wood, leaves } = useMemo(() => TreeGeometryFactory.getTreeGeometry(type), [type]);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useLayoutEffect(() => {
        if (!woodMesh.current) return;

        for (let i = 0; i < count; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            // Add chunk offset here since positions are local to chunk origin (0,0,0) relative to world?
            // Wait, ChunkMesh puts the group at [cx*SIZE, 0, cz*SIZE].
            // The positions in data are:
            // (x - PAD) + (hash * 0.4 - 0.2)
            // x is 0..31 relative to chunk start?
            // In terrainService: 
            // floraCandidates.push((x - PAD) + ..., (y - PAD) + MESH_Y_OFFSET ..., ...)
            // These are local coordinates relative to the chunk origin.
            // So we just use them directly.

            dummy.position.set(x, y, z);

            // Random rotation
            const seed = x * 12.9898 + z * 78.233;
            dummy.rotation.y = (seed % 1) * Math.PI * 2;

            // Random scale variation
            const scale = 0.8 + (seed % 0.4);
            dummy.scale.setScalar(scale);

            dummy.updateMatrix();
            woodMesh.current.setMatrixAt(i, dummy.matrix);
            if (leafMesh.current) leafMesh.current.setMatrixAt(i, dummy.matrix);
        }

        woodMesh.current.instanceMatrix.needsUpdate = true;
        if (leafMesh.current) leafMesh.current.instanceMatrix.needsUpdate = true;
    }, [positions, count]);

    // Colors
    const colors = useMemo(() => {
        let base = '#3e2723';
        let tip = '#00FFFF';

        if (type === TreeType.OAK) { base = '#4e342e'; tip = '#4CAF50'; }
        else if (type === TreeType.PINE) { base = '#3e2723'; tip = '#1B5E20'; }
        else if (type === TreeType.PALM) { base = '#795548'; tip = '#8BC34A'; }
        else if (type === TreeType.ACACIA) { base = '#6D4C41'; tip = '#CDDC39'; }
        else if (type === TreeType.CACTUS) { base = '#2E7D32'; tip = '#43A047'; }
        else if (type === TreeType.JUNGLE) { base = '#5D4037'; tip = '#2E7D32'; } // Dark wood, deep green leaves

        return { base, tip };
    }, [type]);

    return (
        <group>
            <instancedMesh ref={woodMesh} args={[wood, undefined, count]} castShadow receiveShadow>
                <meshStandardMaterial color={colors.base} roughness={0.9} />
            </instancedMesh>
            {leaves.getAttribute('position') && (
                <instancedMesh ref={leafMesh} args={[leaves, undefined, count]} castShadow receiveShadow>
                    <meshStandardMaterial color={colors.tip} roughness={0.8} />
                </instancedMesh>
            )}
        </group>
    );
};
