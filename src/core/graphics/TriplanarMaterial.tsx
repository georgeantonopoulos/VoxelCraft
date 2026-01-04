import * as THREE from 'three';
import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { sharedUniforms } from './SharedUniforms';

import { triplanarVertexShader as vertexShader, triplanarFragmentShader as fragmentShader } from './TriplanarShader';

// Shared material instance to avoid redundant shader compilation/patching per chunk.
let sharedTerrainMaterial: THREE.MeshStandardMaterial | null = null;
let lastUpdateFrame = -1;

const PLACEHOLDER_NOISE_3D = (() => {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.Data3DTexture(data, 1, 1, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.needsUpdate = true;
  return tex;
})();



const getSharedTerrainMaterial = () => {
  if (sharedTerrainMaterial) return sharedTerrainMaterial;

  const uniforms = {
    ...sharedUniforms,
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
    uWeightsView: { value: 0 },
    // GI uniforms
    uGIEnabled: { value: 1.0 },
    uGIIntensity: { value: 1.2 },
    uTriplanarDetail: sharedUniforms.uTriplanarDetail,
    uShaderFogEnabled: sharedUniforms.uShaderFogEnabled,
    uShaderFogStrength: sharedUniforms.uShaderFogStrength,
    uWetnessEnabled: sharedUniforms.uWetnessEnabled,
    uMossEnabled: sharedUniforms.uMossEnabled,
    uRoughnessMin: sharedUniforms.uRoughnessMin,
    uHeightFogEnabled: sharedUniforms.uHeightFogEnabled,
    uHeightFogStrength: sharedUniforms.uHeightFogStrength,
    uHeightFogRange: sharedUniforms.uHeightFogRange,
    uHeightFogOffset: sharedUniforms.uHeightFogOffset,
    uSunDirection: sharedUniforms.uSunDirection,
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

export interface TriplanarMaterialProps {
  sunDirection?: THREE.Vector3;
  triplanarDetail?: number;
  shaderFogEnabled?: boolean;
  shaderFogStrength?: number;
  threeFogEnabled?: boolean;
  wetnessEnabled?: boolean;
  mossEnabled?: boolean;
  roughnessMin?: number;
  polygonOffsetEnabled?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  weightsView?: string;
  wireframe?: boolean;
  heightFogEnabled?: boolean;
  heightFogStrength?: number;
  heightFogRange?: number;
  heightFogOffset?: number;
  fogNear?: number;
  fogFar?: number;
}

export const TriplanarMaterial: React.FC<TriplanarMaterialProps> = React.memo(({
  sunDirection,
  triplanarDetail = 1.0,
  shaderFogEnabled = true,
  shaderFogStrength = 0.8,
  threeFogEnabled = true,
  wetnessEnabled = true,
  mossEnabled = true,
  roughnessMin = 0.0,
  polygonOffsetEnabled = false,
  polygonOffsetFactor = -1.0,
  polygonOffsetUnits = -1.0,
  weightsView = 'off',
  wireframe = false,
  heightFogEnabled = true,
  heightFogStrength = 0.35,
  heightFogRange = 50.0,
  heightFogOffset = 4.0,
  fogNear = 40,
  fogFar = 220,
}) => {
  const mat = useMemo(() => getSharedTerrainMaterial(), []);

  useFrame((state) => {
    if (!mat) return;
    const uniforms = (mat as any).uniforms;

    // Lazy initialization of common central textures
    if (uniforms.uNoiseTexture.value === PLACEHOLDER_NOISE_3D) {
      uniforms.uNoiseTexture.value = getNoiseTexture();
    }

    // We only update the shared material ONCE per frame, even with 100 chunks.
    if (lastUpdateFrame !== state.gl.info.render.frame) {
      lastUpdateFrame = state.gl.info.render.frame;

      // Apply all props to the shared material instance
      const uniforms = (mat as any).uniforms;

      // If props are provided, they OVERRIDE central state for this material instance (which is shared)
      // Since it's a singleton, the last chunk processed "wins" for that frame.
      // In practice, these settings are global anyway.

      if (sunDirection && (sunDirection as any).isVector3) {
        uniforms.uSunDirection.value.copy(sunDirection);
        uniforms.uSunDir.value.copy(sunDirection);
      }

      uniforms.uTriplanarDetail.value = triplanarDetail;
      uniforms.uShaderFogEnabled.value = shaderFogEnabled ? 1.0 : 0.0;
      uniforms.uShaderFogStrength.value = shaderFogStrength;
      uniforms.uWetnessEnabled.value = wetnessEnabled ? 1.0 : 0.0;
      uniforms.uMossEnabled.value = mossEnabled ? 1.0 : 0.0;
      uniforms.uRoughnessMin.value = roughnessMin;

      mat.polygonOffset = polygonOffsetEnabled;
      mat.polygonOffsetFactor = polygonOffsetFactor;
      mat.polygonOffsetUnits = polygonOffsetUnits;
      mat.wireframe = wireframe;

      const viewMap: Record<string, number> = { off: 0, snow: 1, grass: 2, snowMinusGrass: 3, dominant: 4 };
      uniforms.uWeightsView.value = viewMap[weightsView] ?? 0;

      mat.fog = threeFogEnabled;
      uniforms.uHeightFogEnabled.value = heightFogEnabled ? 1.0 : 0.0;
      uniforms.uHeightFogStrength.value = heightFogStrength;
      uniforms.uHeightFogRange.value = heightFogRange;
      uniforms.uHeightFogOffset.value = heightFogOffset;
      uniforms.uFogNear.value = fogNear;
      uniforms.uFogFar.value = fogFar;

      if (state.scene.fog && (state.scene.fog as any).color) {
        uniforms.uFogColor.value.copy((state.scene.fog as any).color);
      }
    }
  });

  return <primitive object={mat} attach="material" />;
});
