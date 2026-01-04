import * as THREE from 'three';
import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { sharedUniforms } from './SharedUniforms';

import { triplanarVertexShader as vertexShader, triplanarFragmentShader as fragmentShader } from './TriplanarShader';

// Shared material instance to avoid redundant shader compilation/patching per chunk.
let sharedTerrainMaterial: THREE.MeshStandardMaterial | null = null;
let noiseTextureInitialized = false;

const PLACEHOLDER_NOISE_3D = (() => {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.Data3DTexture(data, 1, 1, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.needsUpdate = true;
  return tex;
})();

/**
 * Creates the shared terrain material singleton.
 *
 * All uniform values come from sharedUniforms, which are updated once per frame
 * by VoxelTerrain.tsx via updateSharedUniforms(). This eliminates prop drilling
 * and redundant uniform updates.
 */
const getSharedTerrainMaterial = () => {
  if (sharedTerrainMaterial) return sharedTerrainMaterial;

  // Material-specific uniforms (colors, textures) that don't change per-frame
  const materialUniforms = {
    uNoiseTexture: { value: PLACEHOLDER_NOISE_3D },
    uColorStone: { value: new THREE.Color('#888c8d') },
    uColorGrass: { value: new THREE.Color('#41a024') },
    uColorDirt: { value: new THREE.Color('#755339') },
    uColorSand: { value: new THREE.Color('#ebd89f') },
    uColorSnow: { value: new THREE.Color('#ffffff') },
    uColorWater: { value: new THREE.Color('#0099ff') },
    uColorClay: { value: new THREE.Color('#a67b5b') },
    uColorMoss: { value: new THREE.Color('#4a6b2f') },
    uColorBedrock: { value: new THREE.Color('#2a2a2a') },
    uColorRedSand: { value: new THREE.Color('#d45d35') },
    uColorTerracotta: { value: new THREE.Color('#9e5e45') },
    uColorIce: { value: new THREE.Color('#a3d9ff') },
    uColorJungleGrass: { value: new THREE.Color('#2e8b1d') },
    uColorGlowStone: { value: new THREE.Color('#00e5ff') },
    uColorObsidian: { value: new THREE.Color('#0a0814') },
    uOpacity: { value: 1 },
    uMacroStrength: { value: 1.0 },
    uCavityStrength: { value: 1.0 },
    uWindDirXZ: { value: new THREE.Vector2(0.85, 0.25) },
    uNormalStrength: { value: 1.0 },
    uFogDensity: { value: 0.01 },
    uWaterLevel: { value: 4.5 },
    // GI uniforms
    uGIEnabled: { value: 1.0 },
    uGIIntensity: { value: 1.35 },
  };

  // Merge with sharedUniforms - these are updated by VoxelTerrain each frame
  const uniforms = {
    ...sharedUniforms,
    ...materialUniforms,
  };

  sharedTerrainMaterial = new (CustomShaderMaterial as any)({
    baseMaterial: THREE.MeshStandardMaterial,
    roughness: 0.9,
    metalness: 0.0,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    uniforms: uniforms,
  }) as THREE.MeshStandardMaterial;

  return sharedTerrainMaterial;
};

/**
 * Props that affect material properties (not uniforms).
 * These cannot be in sharedUniforms because they're THREE.Material properties.
 */
export interface TriplanarMaterialProps {
  /** Enable Three.js scene fog on this material */
  threeFogEnabled?: boolean;
  /** Enable polygon offset for z-fighting prevention */
  polygonOffsetEnabled?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  /** Render as wireframe */
  wireframe?: boolean;
}

/**
 * Triplanar terrain material component.
 *
 * Most rendering settings (fog, wetness, moss, triplanar detail, etc.) are now
 * controlled via sharedUniforms, which VoxelTerrain.tsx updates once per frame.
 * This component only handles:
 * 1. Lazy noise texture initialization
 * 2. Material properties that aren't uniforms (wireframe, polygonOffset, fog flag)
 */
export const TriplanarMaterial: React.FC<TriplanarMaterialProps> = React.memo(({
  threeFogEnabled = true,
  polygonOffsetEnabled = false,
  polygonOffsetFactor = -1.0,
  polygonOffsetUnits = -1.0,
  wireframe = false,
}) => {
  const mat = useMemo(() => getSharedTerrainMaterial(), []);

  useFrame((state) => {
    if (!mat) return;

    // Lazy initialization of noise texture (only runs once)
    if (!noiseTextureInitialized) {
      const uniforms = (mat as any).uniforms;
      if (uniforms.uNoiseTexture.value === PLACEHOLDER_NOISE_3D) {
        uniforms.uNoiseTexture.value = getNoiseTexture();
        noiseTextureInitialized = true;
      }
    }

    // Update material properties that can't be uniforms
    // These are inexpensive property assignments, not uniform uploads
    mat.polygonOffset = polygonOffsetEnabled;
    mat.polygonOffsetFactor = polygonOffsetFactor;
    mat.polygonOffsetUnits = polygonOffsetUnits;
    mat.wireframe = wireframe;
    mat.fog = threeFogEnabled;

    // Sync fog color from scene (if scene fog exists)
    if (state.scene.fog && (state.scene.fog as any).color) {
      const uniforms = (mat as any).uniforms;
      uniforms.uFogColor.value.copy((state.scene.fog as any).color);
    }
  });

  return <primitive object={mat} attach="material" />;
});
