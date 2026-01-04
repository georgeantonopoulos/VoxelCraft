import React, { useMemo } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER, ROCK_SHADER, SHARD_SHADER } from '@core/graphics/GroundItemShaders';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { ItemType, CustomTool } from '@/types';
import { getItemColor } from '../logic/ItemRegistry';
import { STICK_SLOTS } from '../../crafting/CraftingData';

// Color constants matching terrain palette
const LASHING_COLOR = '#755339'; // uColorDirt - leather/vine appearance
const LASHING_COLOR_ALT = '#4a6b2f'; // uColorMoss - plant fiber variant

/**
 * Material variants for stones and shards.
 * These map to the terrain color palette from TriplanarMaterial.tsx
 * for visual coherence with the world.
 */
export type MaterialVariant = 'stone' | 'obsidian' | 'basalt' | 'sandstone' | 'clay';

interface MaterialProperties {
    color: string;
    roughness: number;
    metalness: number;
    emissive?: string;
    emissiveIntensity?: number;
}

const MATERIAL_VARIANTS: Record<MaterialVariant, MaterialProperties> = {
    stone: {
        color: '#888c8d',   // uColorStone - default gray stone
        roughness: 0.92,
        metalness: 0.0,
    },
    obsidian: {
        color: '#0a0814',   // uColorObsidian - volcanic glass, very dark
        roughness: 0.1,
        metalness: 0.95,
        emissive: '#1a0828',
        emissiveIntensity: 0.1,
    },
    basalt: {
        color: '#2a2a2a',   // uColorBedrock - dark volcanic rock
        roughness: 0.6,
        metalness: 0.4,
    },
    sandstone: {
        color: '#ebd89f',   // uColorSand - warm desert stone
        roughness: 0.95,
        metalness: 0.0,
    },
    clay: {
        color: '#a67b5b',   // uColorClay - terracotta-like
        roughness: 0.85,
        metalness: 0.0,
    },
};

/**
 * Get material variant from a seed value.
 * Provides deterministic variety based on item identity.
 */
export function getMaterialVariant(seed: number): MaterialVariant {
    const variants: MaterialVariant[] = ['stone', 'obsidian', 'basalt', 'sandstone', 'clay'];
    const index = Math.floor(Math.abs(seed * 43758.5453) % variants.length);
    return variants[index];
}

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

interface StoneMeshProps {
    scale?: number;
    isThumbnail?: boolean;
    variant?: MaterialVariant;
    seed?: number;
}

export const StoneMesh = ({ scale = 1, isThumbnail = false, variant = 'stone', seed = 67.89 }: StoneMeshProps) => {
    const mat = MATERIAL_VARIANTS[variant];

    if (isThumbnail) {
        return (
            <mesh scale={scale}>
                <dodecahedronGeometry args={[0.22, 0]} />
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
        <mesh scale={scale} castShadow receiveShadow>
            <dodecahedronGeometry args={[0.22, 1]} />
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={ROCK_SHADER.vertex}
                uniforms={{
                    uInstancing: { value: false },
                    uNoiseTexture: { value: getNoiseTexture() },
                    uSeed: { value: seed },
                    uDisplacementStrength: { value: 0.15 }
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

interface ShardMeshProps {
    scale?: number;
    isThumbnail?: boolean;
    variant?: MaterialVariant;
    seed?: number;
}

export const ShardMesh = ({ scale = 1, isThumbnail = false, variant = 'obsidian', seed = 42.17 }: ShardMeshProps) => {
    // Shards default to obsidian for a glassy, sharp blade appearance
    // but can use other variants for variety
    const mat = MATERIAL_VARIANTS[variant];

    // For shards, boost metalness slightly for that "blade" look
    const shardMetalness = Math.min(mat.metalness + 0.3, 1.0);
    const shardRoughness = Math.max(mat.roughness * 0.5, 0.1);

    if (isThumbnail) {
        return (
            <mesh scale={scale}>
                <coneGeometry args={[0.1, 0.4, 3]} />
                <meshStandardMaterial
                    color={mat.color}
                    roughness={shardRoughness}
                    metalness={shardMetalness}
                    emissive={mat.emissive || '#000000'}
                    emissiveIntensity={mat.emissiveIntensity || 0}
                />
            </mesh>
        );
    }
    return (
        <mesh scale={scale} castShadow receiveShadow>
            {/* Higher segment count for smoother displacement */}
            <coneGeometry args={[0.1, 0.4, 6, 4]} />
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={SHARD_SHADER.vertex}
                uniforms={{
                    uInstancing: { value: false },
                    uNoiseTexture: { value: getNoiseTexture() },
                    uSeed: { value: seed },
                    uDisplacementStrength: { value: 0.06 }
                }}
                color={mat.color}
                roughness={shardRoughness}
                metalness={shardMetalness}
                emissive={mat.emissive ? new THREE.Color(mat.emissive) : undefined}
                emissiveIntensity={mat.emissiveIntensity || 0}
            />
        </mesh>
    );
};
 
export const FloraMesh = ({ scale = 1, isThumbnail = false }: { scale?: number, isThumbnail?: boolean }) => (
    <group scale={scale}>
        <mesh castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
            <sphereGeometry args={[0.2, isThumbnail ? 8 : 16, isThumbnail ? 8 : 16]} />
            <meshStandardMaterial color="#111" emissive="#00FFFF" emissiveIntensity={1.3} toneMapped={false} />
        </mesh>
        <mesh position={[0.12, -0.08, 0.08]} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
            <sphereGeometry args={[0.12, isThumbnail ? 6 : 12, isThumbnail ? 6 : 12]} />
            <meshStandardMaterial color="#111" emissive="#00FFFF" emissiveIntensity={0.5} toneMapped={false} />
        </mesh>
        <mesh position={[-0.12, -0.12, -0.04]} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
            <sphereGeometry args={[0.1, isThumbnail ? 6 : 12, isThumbnail ? 6 : 12]} />
            <meshStandardMaterial color="#111" emissive="#00FFFF" emissiveIntensity={0.5} toneMapped={false} />
        </mesh>
    </group>
);

/**
 * LashingMesh - Procedural binding wraps that connect attachments to the handle.
 * Creates a helix of wrapped "cord" using TubeGeometry with a CatmullRomCurve3.
 * Visually communicates that the tool is assembled, not magically fused.
 */
interface LashingMeshProps {
    slotId: string;
    attachmentType: ItemType;
    isThumbnail?: boolean;
}

export const LashingMesh: React.FC<LashingMeshProps> = ({ slotId, attachmentType, isThumbnail = false }) => {
    const geometry = useMemo(() => {
        // Generate helix points wrapping around the junction
        const points: THREE.Vector3[] = [];
        const wraps = 3; // Number of full wraps
        const segments = isThumbnail ? 12 : 24;
        const radius = 0.055; // Slightly larger than stick radius (0.045)
        const heightSpan = 0.12; // Vertical extent of the lashing

        // Determine wrap direction based on slot (left wraps one way, right the other)
        const direction = slotId === 'side_right' ? -1 : 1;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * Math.PI * 2 * wraps * direction;
            const y = (t - 0.5) * heightSpan;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            points.push(new THREE.Vector3(x, y, z));
        }

        const curve = new THREE.CatmullRomCurve3(points);
        const tubeRadius = 0.008; // Thin cord
        const tubularSegments = isThumbnail ? 16 : 32;
        const radialSegments = isThumbnail ? 4 : 6;

        return new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false);
    }, [slotId, isThumbnail]);

    // Use moss color for flora attachments, dirt color for everything else
    const color = attachmentType === ItemType.FLORA ? LASHING_COLOR_ALT : LASHING_COLOR;

    // Position the lashing at the junction point (where attachment meets handle)
    // The slot positions are relative to the stick center, so we need to offset
    // to place lashing at the base of where the attachment connects
    const slot = STICK_SLOTS.find(s => s.id === slotId);
    if (!slot) return null;

    // Lashing sits where the attachment base meets the stick
    // For side slots, this is slightly below the slot position
    // For tip_center, it's at the very top of the stick
    const lashingY = slotId === 'tip_center' ? 0.42 : slot.position[1] - 0.08;

    return (
        <mesh
            geometry={geometry}
            position={[0, lashingY, 0]}
            castShadow={!isThumbnail}
            receiveShadow={!isThumbnail}
        >
            <meshStandardMaterial
                color={color}
                roughness={0.85}
                metalness={0.0}
            />
        </mesh>
    );
};

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
                        <FloraMesh isThumbnail={isThumbnail} />
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

