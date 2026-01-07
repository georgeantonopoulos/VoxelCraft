/**
 * BladeGrassLayer.tsx
 *
 * High-quality grass rendering using a single InstancedMesh per chunk.
 * Replaces the multi-layer ProceduralGrassLayer with a more efficient
 * and visually superior approach.
 *
 * Key improvements:
 * - Single draw call per chunk (vs 5 previously)
 * - Thin curved blade geometry (not blocky primitives)
 * - Better wind animation
 * - Root shadowing for grounded look
 */

import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import {
  BLADE_GRASS_CONFIG,
  createBladeGeometry,
  BLADE_GRASS_VERTEX,
  BLADE_GRASS_FRAGMENT,
} from '../shaders/BladeGrassShader';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { getNoiseTexture } from '@core/memory/sharedResources';

interface BladeGrassLayerProps {
  heightTex: Float32Array;
  materialTex: Uint8Array;
  normalTex: Uint8Array;
  biomeTex: Uint8Array;
  caveTex: Uint8Array;
  lightGrid?: Uint8Array;
  chunkX: number;
  chunkZ: number;
  lodLevel: number;
}

// Light grid dimensions
const LIGHT_GRID_SIZE_XZ = 8;
const LIGHT_GRID_SIZE_Y = 32;

/**
 * Get instance count based on LOD level
 */
function getInstanceCount(lodLevel: number): number {
  const counts = BLADE_GRASS_CONFIG.LOD_INSTANCE_COUNTS;
  if (lodLevel >= counts.length) return 0;
  return counts[lodLevel];
}

/**
 * BladeGrassLayer - Single InstancedMesh for all grass in chunk
 */
export const BladeGrassLayer: React.FC<BladeGrassLayerProps> = React.memo(({
  heightTex,
  materialTex,
  normalTex,
  biomeTex,
  caveTex,
  lightGrid,
  chunkX,
  chunkZ,
  lodLevel,
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<CustomShaderMaterial | null>(null);

  // Instance count based on LOD
  const instanceCount = useMemo(() => getInstanceCount(lodLevel), [lodLevel]);

  // Create blade geometry (single shared instance)
  const geometry = useMemo(() => {
    return createBladeGeometry();
  }, []);

  // Create textures from typed arrays
  const textures = useMemo(() => {
    // Height texture (R32F)
    const height = new THREE.DataTexture(
      heightTex,
      32, 32,
      THREE.RedFormat,
      THREE.FloatType
    );
    height.minFilter = THREE.LinearFilter;
    height.magFilter = THREE.LinearFilter;
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

    // Normal texture - expand RG to RGBA
    const normalExpanded = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) {
      normalExpanded[i * 4 + 0] = normalTex[i * 2 + 0];
      normalExpanded[i * 4 + 1] = normalTex[i * 2 + 1];
      normalExpanded[i * 4 + 2] = 128;
      normalExpanded[i * 4 + 3] = 255;
    }
    const normal = new THREE.DataTexture(
      normalExpanded,
      32, 32,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    normal.minFilter = THREE.LinearFilter;
    normal.magFilter = THREE.LinearFilter;
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

    // Cave mask (R8)
    const cave = new THREE.DataTexture(
      caveTex,
      32, 32,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    cave.minFilter = THREE.NearestFilter;
    cave.magFilter = THREE.NearestFilter;
    cave.needsUpdate = true;

    // Light grid 3D texture
    let light: THREE.Data3DTexture | undefined;
    if (lightGrid && lightGrid.length > 0) {
      light = new THREE.Data3DTexture(
        lightGrid,
        LIGHT_GRID_SIZE_XZ,
        LIGHT_GRID_SIZE_Y,
        LIGHT_GRID_SIZE_XZ
      );
      light.format = THREE.RGBAFormat;
      light.type = THREE.UnsignedByteType;
      light.minFilter = THREE.LinearFilter;
      light.magFilter = THREE.LinearFilter;
      light.wrapS = THREE.ClampToEdgeWrapping;
      light.wrapT = THREE.ClampToEdgeWrapping;
      light.wrapR = THREE.ClampToEdgeWrapping;
      light.needsUpdate = true;
    }

    return { height, material, normal, biome, cave, light };
  }, [heightTex, materialTex, normalTex, biomeTex, caveTex, lightGrid]);

  // Chunk offset in world space
  const chunkOffset = useMemo(
    () => new THREE.Vector3(chunkX * 32, 0, chunkZ * 32),
    [chunkX, chunkZ]
  );

  // Create material with custom shader
  const material = useMemo(() => {
    // Dummy 3D light texture if not available
    const dummyLightTex = new THREE.Data3DTexture(
      new Uint8Array([255, 255, 255, 255]),
      1, 1, 1
    );
    dummyLightTex.format = THREE.RGBAFormat;
    dummyLightTex.type = THREE.UnsignedByteType;
    dummyLightTex.needsUpdate = true;

    const mat = new (CustomShaderMaterial as any)({
      baseMaterial: THREE.MeshStandardMaterial,
      vertexShader: BLADE_GRASS_VERTEX,
      fragmentShader: BLADE_GRASS_FRAGMENT,
      uniforms: {
        // Terrain textures
        uHeightMap: { value: textures.height },
        uMaterialMask: { value: textures.material },
        uNormalMap: { value: textures.normal },
        uBiomeMap: { value: textures.biome },
        uCaveMask: { value: textures.cave },
        uLightGrid: { value: textures.light || dummyLightTex },

        // Animation & positioning
        uTime: sharedUniforms.uTime,
        uWindDir: { value: new THREE.Vector2(0.8, 0.3) },
        uChunkOffset: { value: chunkOffset },
        uInstanceCount: { value: instanceCount },

        // GI settings
        uGIEnabled: sharedUniforms.uGIEnabled,
        uGIIntensity: sharedUniforms.uGIIntensity,

        // Noise for variation
        uNoiseTexture: { value: getNoiseTexture() },

        // Sun direction for SSS
        uSunDir: sharedUniforms.uSunDir,

        // Fog uniforms
        uFogColor: sharedUniforms.uFogColor,
        uFogNear: sharedUniforms.uFogNear,
        uFogFar: sharedUniforms.uFogFar,
        uHeightFogEnabled: sharedUniforms.uHeightFogEnabled,
        uHeightFogStrength: sharedUniforms.uHeightFogStrength,
        uHeightFogRange: sharedUniforms.uHeightFogRange,
        uHeightFogOffset: sharedUniforms.uHeightFogOffset,
        uShaderFogStrength: sharedUniforms.uShaderFogStrength,

        // Grass colors (base to tip gradient) - vibrant saturated greens
        uBaseColor: { value: new THREE.Color(0x4ca832) }, // Vibrant green at base
        uTipColor: { value: new THREE.Color(0x8bd955) },  // Bright yellow-green at tips
      },
      color: 0x41a024,
      roughness: 0.6,
      metalness: 0.0,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    materialRef.current = mat;
    return mat;
  }, [textures, chunkOffset, instanceCount]);

  // Update dynamic uniforms
  useEffect(() => {
    if (material.uniforms?.uChunkOffset) {
      material.uniforms.uChunkOffset.value.copy(chunkOffset);
    }
    if (material.uniforms?.uInstanceCount) {
      material.uniforms.uInstanceCount.value = instanceCount;
    }
  }, [chunkOffset, instanceCount, material]);

  // Set bounding box to prevent culling issues
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.frustumCulled = true;
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

  // Cleanup
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      textures.height.dispose();
      textures.material.dispose();
      textures.normal.dispose();
      textures.biome.dispose();
      textures.cave.dispose();
      textures.light?.dispose();
    };
  }, [geometry, material, textures]);

  // Skip rendering if no instances
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

BladeGrassLayer.displayName = 'BladeGrassLayer';
