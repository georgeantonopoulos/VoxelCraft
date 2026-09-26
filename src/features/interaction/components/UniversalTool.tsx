/**
 * UniversalTool.tsx - Unified item rendering for all contexts.
 *
 * Uses shared geometries from ItemGeometry.ts to ensure visual consistency
 * across: held items, crafting preview, inventory thumbnails, physics items.
 */

import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER, ROCK_SHADER, SHARD_SHADER, FLORA_SHADER } from '@core/graphics/GroundItemShaders';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { ItemType, CustomTool } from '@/types';
import { STICK_SLOTS } from '../../crafting/CraftingData';
import { TorchModel } from './TorchModel';
import {
    createStickGeometry,
    createGroundStickGeometry,
    createStoneGeometry,
    createShardGeometry,
    createLashingGeometry,
    createLuminaPlantGeometry,
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
    /** A fallen branch (bent, with a broken twig) like the ones on the ground;
     *  straight when it is a tool handle. */
    natural?: boolean;
}

export const StickMesh: React.FC<StickMeshProps> = ({
    scale = 1,
    height = ITEM_DIMENSIONS.stick.height,
    isThumbnail = false,
    variant = 'default',
    seed = 123.45,
    natural = false
}) => {
    const geometry = useMemo(() => (natural && !isThumbnail ? createGroundStickGeometry() : createStickGeometry(isThumbnail)), [isThumbnail, natural]);
    const mat = STICK_MATERIALS[variant];
    // Memoized: the CSM React wrapper disposes and rebuilds the material whenever
    // the uniforms object identity changes, so an inline literal recompiled it on
    // every re-render.
    const uniforms = useMemo(() => ({
        uInstancing: { value: false },
        uSeed: { value: seed },
        uHeight: { value: height },
        uNoiseTexture: { value: getNoiseTexture() },
        uColor: { value: new THREE.Color(mat.color) }
    }), [seed, height, mat.color]);

    // Scale height proportionally. The branch geometry is in radius units
    // (unit radius, unit length), so it takes the stick's real size here.
    const heightScale = height / ITEM_DIMENSIONS.stick.height;
    const branchR = natural && !isThumbnail ? ITEM_DIMENSIONS.stick.radiusTop : 1;
    const branchL = natural && !isThumbnail ? ITEM_DIMENSIONS.stick.height : 1;

    if (isThumbnail) {
        return (
            <mesh scale={[scale, scale * heightScale, scale]} geometry={geometry}>
                <meshStandardMaterial color={mat.color} roughness={mat.roughness} />
            </mesh>
        );
    }

    return (
        <mesh scale={[scale * branchR, scale * heightScale * branchL, scale * branchR]} geometry={geometry} castShadow receiveShadow>
            <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={STICK_SHADER.vertex}
                fragmentShader={STICK_SHADER.fragment}
                uniforms={uniforms}
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
    // Memoized: the CSM React wrapper disposes and rebuilds the material whenever
    // the uniforms object identity changes, so an inline literal recompiled it on
    // every re-render.
    const uniforms = useMemo(() => ({
        uInstancing: { value: false },
        uNoiseTexture: { value: getNoiseTexture() },
        uSeed: { value: seed },
        uDisplacementStrength: { value: 0.15 },
        uColor: { value: new THREE.Color(mat.color) }
    }), [seed, mat.color]);

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
                uniforms={uniforms}
                color={mat.color}
                roughness={mat.roughness}
                metalness={mat.metalness}
                emissive={mat.emissive || '#000000'}
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
    // Memoized: the CSM React wrapper disposes and rebuilds the material whenever
    // the uniforms object identity changes, so an inline literal recompiled it on
    // every re-render.
    const uniforms = useMemo(() => ({
        uInstancing: { value: false },
        uNoiseTexture: { value: getNoiseTexture() },
        uSeed: { value: seed },
        uDisplacementStrength: { value: 0.08 },
        uColor: { value: new THREE.Color(mat.color) }
    }), [seed, mat.color]);

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
                uniforms={uniforms}
                color={mat.color}
                roughness={mat.roughness}
                metalness={mat.metalness}
                emissive={mat.emissive || '#000000'}
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
    // Memoized: the CSM React wrapper disposes and rebuilds the material whenever
    // the uniforms object identity changes, so an inline literal recompiled it on
    // every re-render.
    // All three lobes share one uTime so they pulse together (only the first
    // lobe's material used to be animated).
    const uniforms = useMemo(() => {
        const uTime = { value: 0 };
        const glow = new THREE.Color(ITEM_COLORS.flora.glow);
        const noise = { value: getNoiseTexture() };
        const lobe = (s: number) => ({ uTime, uSeed: { value: s }, uColor: { value: glow }, uNoiseTexture: noise });
        return { uTime, main: lobe(seed), secondary: lobe(seed + 1.5), tertiary: lobe(seed + 3.0) };
    }, [seed]);

    // Update time uniform for pulsing animation
    useFrame(({ clock }) => {
        if (!isThumbnail) uniforms.uTime.value = clock.getElapsedTime();
    });

    const plant = useMemo(() => createLuminaPlantGeometry(), []);
    // Plant base sits at y = 0; centre it on the item origin like the old bulb.
    const PLANT_SCALE = 1.3;

    return (
        <group scale={scale}>
            <group scale={PLANT_SCALE} position={[0, -0.17 * PLANT_SCALE, 0]}>
                <mesh geometry={plant.stems} castShadow={!isThumbnail} receiveShadow={!isThumbnail}>
                    <meshStandardMaterial color="#2c3d31" roughness={0.8} />
                </mesh>
                <mesh geometry={plant.pods} castShadow={!isThumbnail}>
                    {isThumbnail ? (
                        <meshStandardMaterial color="#c9f7ef" emissive={ITEM_COLORS.flora.glow} emissiveIntensity={1.4} toneMapped={false} />
                    ) : (
                        <CustomShaderMaterial
                            baseMaterial={THREE.MeshStandardMaterial}
                            vertexShader={FLORA_SHADER.vertex}
                            fragmentShader={FLORA_SHADER.fragment}
                            uniforms={uniforms.main}
                            toneMapped={false}
                        />
                    )}
                </mesh>
            </group>
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

    // Position lashing at the junction point. The saw edge is bound once at
    // each end (a binding per flake hid the flakes).
    if (slotId === 'edge_2') return null;
    const lashingY = slotId === 'tip_center' ? 0.42
        : slotId === 'edge_1' ? slot.position[1] + 0.1
        : slotId === 'edge_3' ? slot.position[1] - 0.1
        : slot.position[1] - 0.08;

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
                return <StickMesh isThumbnail={isThumbnail} natural />;
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
                // The same torch as in hand and on the wall (no light of its own:
                // mounting a raw light recompiled every lit shader).
                return (
                    <group scale={thumbScale} position={[0, -0.35, 0]}>
                        <TorchModel length={0.6} />
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
                    <group key={slotId} position={slot.position} rotation={slot.rotation} scale={slot.scale ?? 1}>
                        {attachmentType === ItemType.SHARD && <ShardMesh scale={1.2} isThumbnail={isThumbnail} />}
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
