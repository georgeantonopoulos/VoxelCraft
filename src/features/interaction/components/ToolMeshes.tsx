import React from 'react';
import { ItemType } from '@/types';
import { getItemColor } from '../logic/ItemRegistry';

export const PickaxeMesh: React.FC = () => (
    <group rotation={[0, 0, -Math.PI / 4]}>
        {/* Handle */}
        <mesh position={[0, -0.15, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.7]} />
            <meshStandardMaterial color={getItemColor(ItemType.STICK)} />
        </mesh>
        {/* Head (Double-ended pick) */}
        <group position={[0, 0.2, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.05, 0.05, 0.6, 4]} />
                <meshStandardMaterial color={getItemColor(ItemType.PICKAXE)} metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Points */}
            <mesh position={[0.32, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                <coneGeometry args={[0.05, 0.1, 4]} />
                <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.2} />
            </mesh>
            <mesh position={[-0.32, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <coneGeometry args={[0.05, 0.1, 4]} />
                <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.2} />
            </mesh>
        </group>
    </group>
);

export const AxeMesh: React.FC = () => (
    <group rotation={[0, 0, -Math.PI / 4]}>
        {/* Handle */}
        <mesh position={[0, -0.1, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.6]} />
            <meshStandardMaterial color={getItemColor(ItemType.STICK)} />
        </mesh>
        {/* Blade */}
        <group position={[0, 0.2, 0]}>
            {/* Axe Head */}
            <mesh position={[0.08, 0, 0]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.15, 0.25, 0.04]} />
                <meshStandardMaterial color={getItemColor(ItemType.AXE)} metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Sharp Edge */}
            <mesh position={[0.18, 0, 0]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.05, 0.3, 0.01]} />
                <meshStandardMaterial color="#bbbbbb" metalness={1.0} roughness={0.1} />
            </mesh>
        </group>
    </group>
);
