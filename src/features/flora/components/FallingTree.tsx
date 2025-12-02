import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

interface FallingTreeProps {
    position: THREE.Vector3;
    type: number;
    seed: number; // We pass the seed derived from position to match the static tree
}

export const FallingTree: React.FC<FallingTreeProps> = ({ position, type, seed }) => {
    const { wood, leaves } = useMemo(() => TreeGeometryFactory.getTreeGeometry(type), [type]);

    const { rotation, scale } = useMemo(() => {
        const r = (seed % 1) * Math.PI * 2;
        const s = 0.8 + (seed % 0.4);
        return { rotation: r, scale: s };
    }, [seed]);

    const colors = useMemo(() => {
        let base = '#3e2723';
        let tip = '#00FFFF';

        if (type === TreeType.OAK) { base = '#4e342e'; tip = '#4CAF50'; }
        else if (type === TreeType.PINE) { base = '#3e2723'; tip = '#1B5E20'; }
        else if (type === TreeType.PALM) { base = '#795548'; tip = '#8BC34A'; }
        else if (type === TreeType.ACACIA) { base = '#6D4C41'; tip = '#CDDC39'; }
        else if (type === TreeType.CACTUS) { base = '#2E7D32'; tip = '#43A047'; }

        return { base, tip };
    }, [type]);

    return (
        <RigidBody
            position={position}
            colliders={false}
            type="dynamic"
            linearDamping={0.5}
            angularDamping={0.5}
        >
            {/* Approximate collider for the trunk */}
            <CylinderCollider args={[2.0 * scale, 0.3 * scale]} position={[0, 2.0 * scale, 0]} />

            <group rotation={[0, rotation, 0]} scale={[scale, scale, scale]}>
                <mesh geometry={wood} castShadow receiveShadow>
                    <meshStandardMaterial color={colors.base} roughness={0.9} />
                </mesh>
                <mesh geometry={leaves} castShadow receiveShadow>
                    <meshStandardMaterial color={colors.tip} roughness={0.8} />
                </mesh>
            </group>
        </RigidBody>
    );
};
