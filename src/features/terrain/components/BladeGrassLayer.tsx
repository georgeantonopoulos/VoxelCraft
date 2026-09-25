/**
 * BladeGrassLayer.tsx
 *
 * High-quality grass rendering using a single InstancedMesh per chunk.
 * Replaces the former multi-layer grass layer with a more efficient
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
import { useSettingsStore } from '@state/SettingsStore';
import { LIGHT_GRID_SIZE_XZ, LIGHT_GRID_SIZE_Y } from '@/constants';

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
/** Shared 1x1 white light texture for chunks without a light grid. */
let dummyLightTexture: THREE.Data3DTexture | null = null;
const getDummyLightTexture = (): THREE.Data3DTexture => {
  if (!dummyLightTexture) {
    dummyLightTexture = new THREE.Data3DTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
    dummyLightTexture.format = THREE.RGBAFormat;
    dummyLightTexture.type = THREE.UnsignedByteType;
    dummyLightTexture.needsUpdate = true;
  }
  return dummyLightTexture;
};

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
  const grassDensity = useSettingsStore((st) => st.grassDensity);
  const instanceCount = useMemo(() => Math.round(getInstanceCount(lodLevel) * grassDensity), [lodLevel, grassDensity]);

  // Create blade geometry (single shared instance)
  const geometry = useMemo(() => {
    const g = createBladeGeometry();
    // Instances are placed in the vertex shader across the whole chunk column, so
    // the blade's own tiny bounds would cull the layer. Bounds live on the
    // geometry (not the mesh) so they survive the mesh being recreated.
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -40, -2), new THREE.Vector3(34, 100, 34));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, 30, 16), 70);
    return g;
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
    // Linear: blades threshold the interpolated mask with per-blade dither, so the
    // grass edge follows an organic line instead of voxel-cell steps.
    material.minFilter = THREE.LinearFilter;
    material.magFilter = THREE.LinearFilter;
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
  // Created once per layer. Texture/offset/count changes only swap uniform
  // values (see effects below); rebuilding the material on every remesh (each
  // new light grid) recompiled/re-uploaded far more than needed.
  const material = useMemo(() => {
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
        uLightGrid: { value: textures.light || getDummyLightTexture() },

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap in rebuilt terrain textures (e.g. after digging) and free the old ones.
  useEffect(() => {
    const u = material.uniforms;
    u.uHeightMap.value = textures.height;
    u.uMaterialMask.value = textures.material;
    u.uNormalMap.value = textures.normal;
    u.uBiomeMap.value = textures.biome;
    u.uCaveMask.value = textures.cave;
    u.uLightGrid.value = textures.light || getDummyLightTexture();
    return () => {
      textures.height.dispose();
      textures.material.dispose();
      textures.normal.dispose();
      textures.biome.dispose();
      textures.cave.dispose();
      textures.light?.dispose();
    };
  }, [material, textures]);

  // Update dynamic uniforms
  useEffect(() => {
    if (material.uniforms?.uChunkOffset) {
      material.uniforms.uChunkOffset.value.copy(chunkOffset);
    }
    if (material.uniforms?.uInstanceCount) {
      material.uniforms.uInstanceCount.value = instanceCount;
    }
  }, [chunkOffset, instanceCount, material]);

  // Cleanup
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

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
