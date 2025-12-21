import React, { useMemo } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER, ROCK_SHADER } from '@core/graphics/GroundItemShaders';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { ItemType, CustomTool } from '@/types';
import { getItemColor } from '../logic/ItemRegistry';
import { STICK_SLOTS } from '../../crafting/CraftingData';

// Reusable Meshes for individual components
export const StickMesh = ({ scale = 1, height = 0.95, isThumbnail = false }: { scale?: number, height?: number, isThumbnail?: boolean }) => {
    if (isThumbnail) {
        return (
            <mesh scale={scale}>
                <cylinderGeometry args={[0.045, 0.04, height, 6, 4]} />
                <meshStandardMaterial color={getItemColor(ItemType.STICK)} roughness={0.9} />
            </mesh>
        );
    }
    return (
        <mesh scale={scale} castShadow receiveShadow>
            <cylinderGeometry args={[0.045, 0.04, height, 8, 8]} />
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={STICK_SHADER.vertex}
                uniforms={{
                    uInstancing: { value: false },
                    uSeed: { value: 123.45 },
                    uHeight: { value: height }
                }}
                color={getItemColor(ItemType.STICK)}
                roughness={0.92}
                metalness={0.0}
            />
        </mesh>
    );
};

export const StoneMesh = ({ scale = 1, isThumbnail = false }: { scale?: number, isThumbnail?: boolean }) => {
    if (isThumbnail) {
        return (
            <mesh scale={scale}>
                <dodecahedronGeometry args={[0.22, 0]} />
                <meshStandardMaterial color={getItemColor(ItemType.STONE)} roughness={0.9} />
            </mesh>
        );
    }
    return (
        <mesh scale={scale} castShadow receiveShadow>
            <dodecahedronGeometry args={[0.22, 1]} />
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={ROCK_SHADER.vertex}
                uniforms={{
                    uInstancing: { value: false },
                    uNoiseTexture: { value: getNoiseTexture() },
                    uSeed: { value: 67.89 }
                }}
                color={getItemColor(ItemType.STONE)}
                roughness={0.92}
                metalness={0.0}
            />
        </mesh>
    );
};

export const ShardMesh = ({ scale = 1, isThumbnail = false }: { scale?: number, isThumbnail?: boolean }) => (
    <mesh scale={scale} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
        <coneGeometry args={[0.1, 0.4, isThumbnail ? 3 : 4]} />
        <meshStandardMaterial
            color="#aaaaaa"
            emissive="#000000"
            emissiveIntensity={0}
            roughness={0.2}
            metalness={1.0}
        />
    </mesh>
);

export const AxeHeadMesh = () => (
    <group>
        <mesh castShadow receiveShadow>
            <boxGeometry args={[0.4, 0.2, 0.1]} />
            <meshStandardMaterial color="#888888" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0.2, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.05, 0.25, 0.02]} />
            <meshStandardMaterial color="#bbbbbb" metalness={1.0} roughness={0.1} />
        </mesh>
    </group>
);

export const PickaxeHeadMesh = () => (
    <group>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <cylinderGeometry args={[0.05, 0.05, 0.6, 4]} />
            <meshStandardMaterial color="#888888" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0.3, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow receiveShadow>
            <coneGeometry args={[0.05, 0.1, 4]} />
            <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[-0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
            <coneGeometry args={[0.05, 0.1, 4]} />
            <meshStandardMaterial color="#888888" metalness={0.9} roughness={0.2} />
        </mesh>
    </group>
);

interface UniversalToolProps {
    item: ItemType | string | CustomTool;
    isThumbnail?: boolean;
}

export const UniversalTool: React.FC<UniversalToolProps> = ({ item, isThumbnail = false }) => {
    // If thumbnail, we might want to scale up or center things differently
    const thumbScale = isThumbnail ? 1.2 : 1.0;

    // Resolve tool object
    const tool = useMemo(() => {
        if (typeof item === 'object') return item as CustomTool;
        return null;
    }, [item]);

    // Handle simple ItemTypes
    if (!tool) {
        const type = typeof item === 'string' ? item as ItemType : item;

        switch (type) {
            case ItemType.STICK: return <StickMesh isThumbnail={isThumbnail} />;
            case ItemType.STONE: return <StoneMesh isThumbnail={isThumbnail} />;
            case ItemType.SHARD: return <ShardMesh isThumbnail={isThumbnail} />;
            case ItemType.PICKAXE:
                return (
                    <group scale={thumbScale}>
                        <StickMesh height={0.8} isThumbnail={isThumbnail} />
                        <group position={[0, 0.35, 0]}>
                            <PickaxeHeadMesh />
                        </group>
                    </group>
                );
            case ItemType.AXE:
                return (
                    <group scale={thumbScale}>
                        <StickMesh height={0.8} isThumbnail={isThumbnail} />
                        <group position={[0, 0.3, 0]}>
                            <AxeHeadMesh />
                        </group>
                    </group>
                );
            case ItemType.TORCH:
                return (
                    <group scale={thumbScale}>
                        {/* Handle */}
                        <mesh position={[0, -0.1, 0]}>
                            <cylinderGeometry args={[0.035, 0.045, 0.7, 8]} />
                            <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
                        </mesh>
                        {/* Collar */}
                        <mesh position={[0, 0.3, 0]}>
                            <cylinderGeometry args={[0.055, 0.055, 0.06, 10]} />
                            <meshStandardMaterial color="#3a3a44" roughness={0.4} metalness={0.6} />
                        </mesh>
                        {/* Ember */}
                        <mesh position={[0, 0.42, 0]}>
                            <sphereGeometry args={[0.06, 12, 10]} />
                            <meshStandardMaterial color="#ff9b47" emissive="#ff6b1a" emissiveIntensity={2.2} toneMapped={false} />
                        </mesh>
                        {/* Glow shell */}
                        {!isThumbnail && (
                            <mesh position={[0, 0.46, 0]}>
                                <sphereGeometry args={[0.11, 12, 10]} />
                                <meshStandardMaterial color="#ffd39a" emissive="#ffb36b" emissiveIntensity={1.8} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                            </mesh>
                        )}
                        {!isThumbnail && <pointLight position={[0, 0.5, 0]} intensity={2} color="#ffaa00" distance={10} />}
                    </group>
                );
            case ItemType.FLORA:
                return (
                    <group scale={thumbScale}>
                        <mesh castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
                            <sphereGeometry args={[0.2, 16, 16]} />
                            <meshStandardMaterial color="#111" emissive="#00FFFF" emissiveIntensity={1.3} toneMapped={false} />
                        </mesh>
                        <mesh position={[0.12, -0.08, 0.08]} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
                            <sphereGeometry args={[0.12, 12, 12]} />
                            <meshStandardMaterial color="#111" emissive="#00FFFF" emissiveIntensity={0.5} toneMapped={false} />
                        </mesh>
                        <mesh position={[-0.12, -0.12, -0.04]} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
                            <sphereGeometry args={[0.1, 12, 12]} />
                            <meshStandardMaterial color="#111" emissive="#00FFFF" emissiveIntensity={0.5} toneMapped={false} />
                        </mesh>
                    </group>
                );
            default: return null;
        }
    }

    // Handle Custom Tools
    return (
        <group scale={thumbScale}>
            {/* Base Item */}
            {tool.baseType === ItemType.STICK && <StickMesh isThumbnail={isThumbnail} />}

            {/* Attachments */}
            {Object.entries(tool.attachments).map(([slotId, attachmentType]) => {
                const slot = STICK_SLOTS.find(s => s.id === slotId);
                if (!slot) return null;

                return (
                    <group key={slotId} position={slot.position} rotation={slot.rotation}>
                        {attachmentType === ItemType.SHARD && <ShardMesh scale={0.6} isThumbnail={isThumbnail} />}
                        {attachmentType === ItemType.STONE && <StoneMesh scale={0.5} isThumbnail={isThumbnail} />}
                        {attachmentType === ItemType.STICK && <StickMesh scale={0.4} height={0.5} isThumbnail={isThumbnail} />}
                        {attachmentType === ItemType.FLORA && (
                            <group scale={0.4}>
                                <mesh castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
                                    <sphereGeometry args={[0.2, isThumbnail ? 8 : 16, isThumbnail ? 8 : 16]} />
                                    <meshStandardMaterial color="#111" emissive="#00FFFF" emissiveIntensity={1.3} toneMapped={false} />
                                </mesh>
                                {/* Only add individual attachment light if not a thumbnail and not first person? 
                                    Actually, for now, strictly NO lights in thumbnails. */}
                                {!isThumbnail && (
                                    <pointLight intensity={0.5} color="#00FFFF" distance={1.0} />
                                )}
                            </group>
                        )}
                    </group>
                );
            })}
        </group>
    );
};

