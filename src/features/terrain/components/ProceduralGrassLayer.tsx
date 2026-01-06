/**
 * ProceduralGrassLayer.tsx
 *
 * GPU-based procedural vegetation rendering.
 * Uses texture lookups instead of CPU-generated position arrays.
 * Grass positions are computed in the vertex shader from instance ID.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { PROCEDURAL_GRASS_SHADER, GRASS_GRID_SIZE, VEG_TYPE_COLORS } from '../shaders/ProceduralGrassShader';
import { VEGETATION_GEOMETRIES } from '../logic/VegetationGeometries';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { getNoiseTexture } from '@core/memory/sharedResources';

interface ProceduralGrassLayerProps {
  heightTex: Float32Array;
  materialTex: Uint8Array;
  normalTex: Uint8Array;
  biomeTex: Uint8Array;
  caveTex: Uint8Array;
  chunkX: number;
  chunkZ: number;
  lodLevel: number;
}

// Vegetation type configuration
const VEG_TYPES = [
  { id: 0, name: 'grass_low', color: VEG_TYPE_COLORS.grass_low, geometry: 'grass_low' },
  { id: 1, name: 'grass_tall', color: VEG_TYPE_COLORS.grass_tall, geometry: 'grass_tall' },
  { id: 2, name: 'fern', color: VEG_TYPE_COLORS.fern, geometry: 'fern' },
  { id: 3, name: 'flower', color: VEG_TYPE_COLORS.flower, geometry: 'flower' },
] as const;

// Total instances = GRASS_GRID_SIZE^2 (imported from shader for single source of truth)
const TOTAL_INSTANCES = GRASS_GRID_SIZE * GRASS_GRID_SIZE;

// Instance counts based on LOD
const getInstanceCount = (lodLevel: number): number => {
  if (lodLevel <= 0) return TOTAL_INSTANCES;      // Full density (4096)
  if (lodLevel <= 1) return TOTAL_INSTANCES / 2;  // 50% (2048)
  if (lodLevel <= 2) return TOTAL_INSTANCES / 4;  // 25% (1024)
  return 0; // LOD 3+ = no vegetation
};

/**
 * Single vegetation type sub-layer
 */
const VegetationTypeLayer: React.FC<{
  vegType: typeof VEG_TYPES[number];
  textures: {
    height: THREE.DataTexture;
    material: THREE.DataTexture;
    normal: THREE.DataTexture;
    biome: THREE.DataTexture;
    cave: THREE.DataTexture;
  };
  chunkOffset: THREE.Vector3;
  instanceCount: number;
}> = React.memo(({ vegType, textures, chunkOffset, instanceCount }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Get base geometry for this vegetation type
  const geometry = useMemo(() => {
    const baseGeo = VEGETATION_GEOMETRIES[vegType.geometry as keyof typeof VEGETATION_GEOMETRIES];
    if (!baseGeo) return VEGETATION_GEOMETRIES.grass_low;
    return baseGeo;
  }, [vegType.geometry]);

  // Create material with custom shader
  const material = useMemo(() => {
    const mat = new (CustomShaderMaterial as any)({
      baseMaterial: THREE.MeshStandardMaterial,
      vertexShader: PROCEDURAL_GRASS_SHADER.vertex,
      fragmentShader: PROCEDURAL_GRASS_SHADER.fragment,
      uniforms: {
        uHeightMap: { value: textures.height },
        uMaterialMask: { value: textures.material },
        uNormalMap: { value: textures.normal },
        uBiomeMap: { value: textures.biome },
        uCaveMask: { value: textures.cave },
        uTime: sharedUniforms.uTime,
        uWindDir: { value: new THREE.Vector2(0.85, 0.25) },
        uChunkOffset: { value: chunkOffset },
        uVegType: { value: vegType.id },
        uGridSize: { value: GRASS_GRID_SIZE },
        uNoiseTexture: { value: getNoiseTexture() },
        uSunDir: sharedUniforms.uSunDir,
        uFogColor: sharedUniforms.uFogColor,
        uFogNear: sharedUniforms.uFogNear,
        uFogFar: sharedUniforms.uFogFar,
        uHeightFogEnabled: sharedUniforms.uHeightFogEnabled,
        uHeightFogStrength: sharedUniforms.uHeightFogStrength,
        uHeightFogRange: sharedUniforms.uHeightFogRange,
        uHeightFogOffset: sharedUniforms.uHeightFogOffset,
        uShaderFogStrength: sharedUniforms.uShaderFogStrength,
      },
      color: vegType.color,
      roughness: 0.4,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    return mat;
  }, [textures, chunkOffset, vegType]);

  // Update chunk offset uniform when it changes
  useEffect(() => {
    if (material.uniforms?.uChunkOffset) {
      material.uniforms.uChunkOffset.value.copy(chunkOffset);
    }
  }, [chunkOffset, material]);

  // Set conservative bounding box to prevent culling issues
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.frustumCulled = true;
      // Match terrain chunk bounds
      const box = new THREE.Box3(
        new THREE.Vector3(-2, -40, -2),
        new THREE.Vector3(34, 100, 34)
      );
      meshRef.current.geometry.boundingBox = box;
      meshRef.current.geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(16, 30, 16),
        70
      );
    }
  }, []);

  if (instanceCount <= 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instanceCount]}
      castShadow={false}
      receiveShadow
    />
  );
});

VegetationTypeLayer.displayName = 'VegetationTypeLayer';

/**
 * Main procedural grass layer component
 */
export const ProceduralGrassLayer: React.FC<ProceduralGrassLayerProps> = React.memo(({
  heightTex,
  materialTex,
  normalTex,
  biomeTex,
  caveTex,
  chunkX,
  chunkZ,
  lodLevel,
}) => {
  // Create Three.js textures from typed arrays
  const textures = useMemo(() => {
    // Height texture (R32F)
    const height = new THREE.DataTexture(
      heightTex,
      32, 32,
      THREE.RedFormat,
      THREE.FloatType
    );
    height.minFilter = THREE.NearestFilter;
    height.magFilter = THREE.NearestFilter;
    height.needsUpdate = true;

    // Material mask (R8)
    const material = new THREE.DataTexture(
      materialTex,
      32, 32,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    material.minFilter = THREE.NearestFilter;
    material.magFilter = THREE.NearestFilter;
    material.needsUpdate = true;

    // Normal texture (RG8) - Note: Three.js needs RGBA, so we'll expand
    const normalExpanded = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) {
      normalExpanded[i * 4 + 0] = normalTex[i * 2 + 0]; // R
      normalExpanded[i * 4 + 1] = normalTex[i * 2 + 1]; // G
      normalExpanded[i * 4 + 2] = 128; // B (unused, set to 0.5)
      normalExpanded[i * 4 + 3] = 255; // A
    }
    const normal = new THREE.DataTexture(
      normalExpanded,
      32, 32,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    normal.minFilter = THREE.NearestFilter;
    normal.magFilter = THREE.NearestFilter;
    normal.needsUpdate = true;

    // Biome texture (R8)
    const biome = new THREE.DataTexture(
      biomeTex,
      32, 32,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    biome.minFilter = THREE.NearestFilter;
    biome.magFilter = THREE.NearestFilter;
    biome.needsUpdate = true;

    // Cave mask texture (R8)
    const cave = new THREE.DataTexture(
      caveTex,
      32, 32,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    cave.minFilter = THREE.NearestFilter;
    cave.magFilter = THREE.NearestFilter;
    cave.needsUpdate = true;

    return { height, material, normal, biome, cave };
  }, [heightTex, materialTex, normalTex, biomeTex, caveTex]);

  // Cleanup textures on unmount
  useEffect(() => {
    return () => {
      textures.height.dispose();
      textures.material.dispose();
      textures.normal.dispose();
      textures.biome.dispose();
      textures.cave.dispose();
    };
  }, [textures]);

  // Chunk offset in world space
  const chunkOffset = useMemo(
    () => new THREE.Vector3(chunkX * 32, 0, chunkZ * 32),
    [chunkX, chunkZ]
  );

  // Instance count based on LOD
  const instanceCount = useMemo(() => getInstanceCount(lodLevel), [lodLevel]);

  // Skip rendering if no instances
  if (instanceCount <= 0) return null;

  return (
    <group>
      {VEG_TYPES.map((vegType) => (
        <VegetationTypeLayer
          key={vegType.id}
          vegType={vegType}
          textures={textures}
          chunkOffset={chunkOffset}
          instanceCount={instanceCount}
        />
      ))}
    </group>
  );
});

ProceduralGrassLayer.displayName = 'ProceduralGrassLayer';
