/**
 * UniversalTool.tsx - Unified item rendering for all contexts.
 *
 * Uses shared geometries from ItemGeometry.ts to ensure visual consistency
 * across: held items, crafting preview, inventory thumbnails, physics items.
 */

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER, ROCK_SHADER, SHARD_SHADER, FLORA_SHADER, TORCH_SHADER } from '@core/graphics/GroundItemShaders';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { ItemType, CustomTool } from '@/types';
import { STICK_SLOTS } from '../../crafting/CraftingData';
import {
    createStickGeometry,
    createStoneGeometry,
    createShardGeometry,
    createLashingGeometry,
    getFloraGeometryConfig,
    STONE_MATERIALS,
    SHARD_MATERIALS,
    STICK_MATERIALS,
    ITEM_COLORS,
    ITEM_DIMENSIONS,
    type StoneVariant,
    type ShardVariant,
    type StickVariant,
    getStoneVariantFromSeed,
    getShardVariantFromSeed,
} from '@core/items/ItemGeometry';

// Re-export types for backwards compatibility
export type MaterialVariant = StoneVariant;
export { getStoneVariantFromSeed as getMaterialVariant };

// ============================================================================
// STICK MESH
// ============================================================================

interface StickMeshProps {
    scale?: number;
    height?: number;
    isThumbnail?: boolean;
    variant?: StickVariant;
    seed?: number;
}

export const StickMesh: React.FC<StickMeshProps> = ({
    scale = 1,
    height = ITEM_DIMENSIONS.stick.height,
    isThumbnail = false,
    variant = 'default',
    seed = 123.45
}) => {
    const geometry = useMemo(() => createStickGeometry(isThumbnail), [isThumbnail]);
    const mat = STICK_MATERIALS[variant];

    // Scale height proportionally
    const heightScale = height / ITEM_DIMENSIONS.stick.height;

    if (isThumbnail) {
        return (
            <mesh scale={[scale, scale * heightScale, scale]} geometry={geometry}>
                <meshStandardMaterial color={mat.color} roughness={mat.roughness} />
            </mesh>
        );
    }

    return (
        <mesh scale={[scale, scale * heightScale, scale]} geometry={geometry} castShadow receiveShadow>
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={STICK_SHADER.vertex}
                fragmentShader={STICK_SHADER.fragment}
                uniforms={{
                    uInstancing: { value: false },
                    uSeed: { value: seed },
                    uHeight: { value: height },
                    uNoiseTexture: { value: getNoiseTexture() },
                    uColor: { value: new THREE.Color(mat.color) }
                }}
                color={mat.color}
                roughness={mat.roughness}
                metalness={mat.metalness}
            />
        </mesh>
    );
};

// ============================================================================
// STONE MESH
// ============================================================================

interface StoneMeshProps {
    scale?: number;
    isThumbnail?: boolean;
    variant?: StoneVariant;
    seed?: number;
}

export const StoneMesh: React.FC<StoneMeshProps> = ({
    scale = 1,
    isThumbnail = false,
    variant = 'default',
    seed = 67.89
}) => {
    const geometry = useMemo(() => createStoneGeometry(isThumbnail), [isThumbnail]);
    const mat = STONE_MATERIALS[variant];

    if (isThumbnail) {
        return (
            <mesh scale={scale} geometry={geometry}>
                <meshStandardMaterial
                    color={mat.color}
                    roughness={mat.roughness}
                    metalness={mat.metalness}
                    emissive={mat.emissive || '#000000'}
                    emissiveIntensity={mat.emissiveIntensity || 0}
                />
            </mesh>
        );
    }

    return (
        <mesh scale={scale} geometry={geometry} castShadow receiveShadow>
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={ROCK_SHADER.vertex}
                fragmentShader={ROCK_SHADER.fragment}
                uniforms={{
                    uInstancing: { value: false },
                    uNoiseTexture: { value: getNoiseTexture() },
                    uSeed: { value: seed },
                    uDisplacementStrength: { value: 0.15 },
                    uColor: { value: new THREE.Color(mat.color) }
                }}
                color={mat.color}
                roughness={mat.roughness}
                metalness={mat.metalness}
                emissive={mat.emissive ? new THREE.Color(mat.emissive) : undefined}
                emissiveIntensity={mat.emissiveIntensity || 0}
            />
        </mesh>
    );
};

// ============================================================================
// SHARD MESH - Now uses octahedron for blade-like appearance
// ============================================================================

interface ShardMeshProps {
    scale?: number;
    isThumbnail?: boolean;
    variant?: ShardVariant;
    seed?: number;
}

export const ShardMesh: React.FC<ShardMeshProps> = ({
    scale = 1,
    isThumbnail = false,
    variant = 'default',
    seed = 42.17
}) => {
    const geometry = useMemo(() => createShardGeometry(isThumbnail), [isThumbnail]);
    const mat = SHARD_MATERIALS[variant];

    if (isThumbnail) {
        return (
            <mesh scale={scale} geometry={geometry}>
                <meshStandardMaterial
                    color={mat.color}
                    roughness={mat.roughness}
                    metalness={mat.metalness}
                    emissive={mat.emissive || '#000000'}
                    emissiveIntensity={mat.emissiveIntensity || 0}
                />
            </mesh>
        );
    }

    return (
        <mesh scale={scale} geometry={geometry} castShadow receiveShadow>
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={SHARD_SHADER.vertex}
                fragmentShader={SHARD_SHADER.fragment}
                uniforms={{
                    uInstancing: { value: false },
                    uNoiseTexture: { value: getNoiseTexture() },
                    uSeed: { value: seed },
                    uDisplacementStrength: { value: 0.08 },
                    uColor: { value: new THREE.Color(mat.color) }
                }}
                color={mat.color}
                roughness={mat.roughness}
                metalness={mat.metalness}
                emissive={mat.emissive ? new THREE.Color(mat.emissive) : undefined}
                emissiveIntensity={mat.emissiveIntensity || 0}
            />
        </mesh>
    );
};

// ============================================================================
// FLORA MESH
// ============================================================================

interface FloraMeshProps {
    scale?: number;
    isThumbnail?: boolean;
    seed?: number;
}

export const FloraMesh: React.FC<FloraMeshProps> = ({ scale = 1, isThumbnail = false, seed = 0 }) => {
    const config = getFloraGeometryConfig(isThumbnail);
    const materialRef = useRef<any>(null);

    // Update time uniform for pulsing animation
    useFrame(({ clock }) => {
        if (materialRef.current?.uniforms && !isThumbnail) {
            materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
        }
    });

    // Thumbnail uses simple material for performance
    if (isThumbnail) {
        return (
            <group scale={scale}>
                <mesh>
                    <sphereGeometry args={[config.main.radius, config.main.segments, config.main.segments]} />
                    <meshStandardMaterial
                        color={ITEM_COLORS.flora.base}
                        emissive={ITEM_COLORS.flora.glow}
                        emissiveIntensity={1.3}
                        toneMapped={false}
                    />
                </mesh>
                <mesh position={config.secondary.position}>
                    <sphereGeometry args={[config.secondary.radius, config.secondary.segments, config.secondary.segments]} />
                    <meshStandardMaterial
                        color={ITEM_COLORS.flora.base}
                        emissive={ITEM_COLORS.flora.glow}
                        emissiveIntensity={0.5}
                        toneMapped={false}
                    />
                </mesh>
                <mesh position={config.tertiary.position}>
                    <sphereGeometry args={[config.tertiary.radius, config.tertiary.segments, config.tertiary.segments]} />
                    <meshStandardMaterial
                        color={ITEM_COLORS.flora.base}
                        emissive={ITEM_COLORS.flora.glow}
                        emissiveIntensity={0.5}
                        toneMapped={false}
                    />
                </mesh>
            </group>
        );
    }

    return (
        <group scale={scale}>
            <mesh castShadow receiveShadow>
                <sphereGeometry args={[config.main.radius, config.main.segments, config.main.segments]} />
                <CustomShaderMaterial
                    ref={materialRef}
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={FLORA_SHADER.vertex}
                    fragmentShader={FLORA_SHADER.fragment}
                    uniforms={{
                        uTime: { value: 0 },
                        uSeed: { value: seed },
                        uColor: { value: new THREE.Color(ITEM_COLORS.flora.glow) },
                        uNoiseTexture: { value: getNoiseTexture() }
                    }}
                    toneMapped={false}
                />
            </mesh>
            <mesh position={config.secondary.position} castShadow receiveShadow>
                <sphereGeometry args={[config.secondary.radius, config.secondary.segments, config.secondary.segments]} />
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={FLORA_SHADER.vertex}
                    fragmentShader={FLORA_SHADER.fragment}
                    uniforms={{
                        uTime: { value: 0 },
                        uSeed: { value: seed + 1.5 },
                        uColor: { value: new THREE.Color(ITEM_COLORS.flora.glow) },
                        uNoiseTexture: { value: getNoiseTexture() }
                    }}
                    toneMapped={false}
                />
            </mesh>
            <mesh position={config.tertiary.position} castShadow receiveShadow>
                <sphereGeometry args={[config.tertiary.radius, config.tertiary.segments, config.tertiary.segments]} />
                <CustomShaderMaterial
                    baseMaterial={THREE.MeshStandardMaterial}
                    vertexShader={FLORA_SHADER.vertex}
                    fragmentShader={FLORA_SHADER.fragment}
                    uniforms={{
                        uTime: { value: 0 },
                        uSeed: { value: seed + 3.0 },
                        uColor: { value: new THREE.Color(ITEM_COLORS.flora.glow) },
                        uNoiseTexture: { value: getNoiseTexture() }
                    }}
                    toneMapped={false}
                />
            </mesh>
        </group>
    );
};

// ============================================================================
// LASHING MESH - Binding wraps connecting attachments to handle
// ============================================================================

interface LashingMeshProps {
    slotId: string;
    attachmentType: ItemType;
    isThumbnail?: boolean;
}

export const LashingMesh: React.FC<LashingMeshProps> = ({ slotId, attachmentType, isThumbnail = false }) => {
    const geometry = useMemo(() => createLashingGeometry(slotId, isThumbnail), [slotId, isThumbnail]);

    // Use moss color for flora attachments, leather for everything else
    const color = attachmentType === ItemType.FLORA
        ? ITEM_COLORS.lashing.fiber
        : ITEM_COLORS.lashing.leather;

    const slot = STICK_SLOTS.find(s => s.id === slotId);
    if (!slot) return null;

    // Position lashing at the junction point
    const lashingY = slotId === 'tip_center' ? 0.42 : slot.position[1] - 0.08;

    return (
        <mesh
            geometry={geometry}
            position={[0, lashingY, 0]}
            castShadow={!isThumbnail}
            receiveShadow={!isThumbnail}
        >
            <meshStandardMaterial color={color} roughness={0.85} metalness={0.0} />
        </mesh>
    );
};

// ============================================================================
// TOOL HEAD MESHES (Axe, Pickaxe)
// ============================================================================

export const AxeHeadMesh: React.FC = () => (
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

export const PickaxeHeadMesh: React.FC = () => (
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

// ============================================================================
// UNIVERSAL TOOL - Main dispatcher component
// ============================================================================

interface UniversalToolProps {
    item: ItemType | string | CustomTool | null;
    isThumbnail?: boolean;
}

export const UniversalTool: React.FC<UniversalToolProps> = ({ item, isThumbnail = false }) => {
    const thumbScale = isThumbnail ? 1.2 : 1.0;

    // Resolve tool object
    const tool = useMemo(() => {
        if (typeof item === 'object' && item !== null) return item as CustomTool;
        return null;
    }, [item]);

    // Handle null/undefined
    if (!item) return null;

    // Handle simple ItemTypes
    if (!tool) {
        const type = typeof item === 'string' ? item as ItemType : item;

        switch (type) {
            case ItemType.STICK:
                return <StickMesh isThumbnail={isThumbnail} />;
            case ItemType.STONE:
                return <StoneMesh isThumbnail={isThumbnail} />;
            case ItemType.SHARD:
                return <ShardMesh isThumbnail={isThumbnail} />;
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
                        {/* Handle with wood grain shader */}
                        <mesh position={[0, -0.1, 0]} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
                            <cylinderGeometry args={[0.035, 0.045, 0.7, 8, 8]} />
                            {isThumbnail ? (
                                <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
                            ) : (
                                <CustomShaderMaterial
                                    baseMaterial={THREE.MeshStandardMaterial}
                                    vertexShader={TORCH_SHADER.vertex}
                                    fragmentShader={TORCH_SHADER.fragment}
                                    uniforms={{
                                        uSeed: { value: 42.0 },
                                        uColor: { value: new THREE.Color('#6b4a2f') },
                                        uNoiseTexture: { value: getNoiseTexture() }
                                    }}
                                    roughness={0.9}
                                />
                            )}
                        </mesh>
                        {/* Collar */}
                        <mesh position={[0, 0.3, 0]} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
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
                                <meshStandardMaterial
                                    color="#ffd39a"
                                    emissive="#ffb36b"
                                    emissiveIntensity={1.8}
                                    transparent
                                    opacity={0.3}
                                    depthWrite={false}
                                    blending={THREE.AdditiveBlending}
                                    toneMapped={false}
                                />
                            </mesh>
                        )}
                        {!isThumbnail && <pointLight position={[0, 0.5, 0]} intensity={2} color="#ffaa00" distance={10} />}
                    </group>
                );
            case ItemType.FLORA:
                return (
                    <group scale={thumbScale}>
                        <FloraMesh isThumbnail={isThumbnail} />
                    </group>
                );
            default:
                return null;
        }
    }

    // Handle Custom Tools
    return (
        <group scale={thumbScale}>
            {/* Base Item */}
            {tool.baseType === ItemType.STICK && <StickMesh isThumbnail={isThumbnail} />}

            {/* Lashings - rendered first so they appear behind attachments */}
            {Object.entries(tool.attachments).map(([slotId, attachmentType]) => (
                <LashingMesh
                    key={`lashing-${slotId}`}
                    slotId={slotId}
                    attachmentType={attachmentType}
                    isThumbnail={isThumbnail}
                />
            ))}

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
                                <FloraMesh isThumbnail={isThumbnail} />
                                {!isThumbnail && (
                                    <pointLight intensity={0.5} color={ITEM_COLORS.flora.glow} distance={1.0} />
                                )}
                            </group>
                        )}
                    </group>
                );
            })}
        </group>
    );
};
