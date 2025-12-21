import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { sharedUniforms } from './SharedUniforms';

import { triplanarVertexShader as vertexShader, triplanarFragmentShader as fragmentShader } from './TriplanarShader';

// Shared material instance to avoid redundant shader compilation/patching per chunk.
// All chunks share this material; variety is provided by geometry attributes (wetness, spawnTime, etc.)
let sharedTerrainMaterial: THREE.MeshStandardMaterial | null = null;

// Placeholder 1x1x1 3D texture - only used until material creation completes.
// The real noise texture is assigned synchronously in getSharedTerrainMaterial().
const PLACEHOLDER_NOISE_3D = (() => {
  const data = new Uint8Array([255, 255, 255, 255]); // 1x1x1 RGBA - White (Max Intensity)
  // White avoids 'black/dark' terrain (0.6 intensity) by boosting it to 1.2
  // AND avoids 'Crazy RGB' caustics (which trigger on 0.5 gray values).
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
    uNoiseTexture: { value: PLACEHOLDER_NOISE_3D }, // Will be replaced lazily
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
    uFogColor: { value: new THREE.Color('#87CEEB') },
    uFogNear: { value: 30 },
    uFogFar: { value: 400 },
    uOpacity: { value: 1 },
    uSunDirection: sharedUniforms.uSunDir,
    uWaterLevel: { value: 4.5 },
    uTriplanarDetail: { value: 1.0 },
    uShaderFogEnabled: { value: 1.0 },
    uShaderFogStrength: { value: 0.9 },
    uWetnessEnabled: { value: 1.0 },
    uMossEnabled: { value: 1.0 },
    uRoughnessMin: { value: 0.0 },
    uWeightsView: { value: 0 },
    uMacroStrength: { value: 1.0 },
    uCavityStrength: { value: 1.0 },
    uWindDirXZ: { value: new THREE.Vector2(0.85, 0.25) },
    uNormalStrength: { value: 1.0 },
    uFogDensity: { value: 0.01 },
    uHeightFogEnabled: { value: 1.0 },
    uHeightFogStrength: { value: 0.5 },
    uHeightFogRange: { value: 20.0 },
    uHeightFogOffset: { value: 10.0 },
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

export const TriplanarMaterial: React.FC<{
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
  waterLevel?: number;
  heightFogEnabled?: boolean;
  heightFogStrength?: number;
  heightFogRange?: number;
  heightFogOffset?: number;
  fogNear?: number;
  fogFar?: number;
}> = ({
  triplanarDetail = 1.0,
  shaderFogEnabled = true,
  shaderFogStrength = 0.9,
  threeFogEnabled = true,
  wetnessEnabled = true,
  mossEnabled = true,
  roughnessMin = 0.0,
  polygonOffsetEnabled = false,
  polygonOffsetFactor = -1.0,
  polygonOffsetUnits = -1.0,
  weightsView = 'off',
  wireframe = false,
  waterLevel = 4.5,
  heightFogEnabled = true,
  heightFogStrength = 0.5,
  heightFogRange = 20.0,
  heightFogOffset = 10.0,
  fogNear = 20,
  fogFar = 250,
}) => {
    const { scene } = useThree();
    const lastFogRef = useRef<{ near: number; far: number; colorHex: string } | null>(null);

    const mat = useMemo(() => getSharedTerrainMaterial(), []);

    // Track the last frame we updated the shared material to avoid 
    // redundant work across hundreds of chunks.
    const lastUpdateFrameRef = useRef(-1);

    useFrame((state) => {
      const matAny = mat as any;
      if (!matAny) return;

      // Lazy initialization of noise texture (deferred from module load to avoid memory allocation failures)
      if (matAny.uniforms.uNoiseTexture.value === PLACEHOLDER_NOISE_3D) {
        matAny.uniforms.uNoiseTexture.value = getNoiseTexture();
      }

      // Only update global/shared uniforms once per frame
      if (lastUpdateFrameRef.current !== state.gl.info.render.frame) {
        lastUpdateFrameRef.current = state.gl.info.render.frame;

        // Avoid per-frame churn: only touch uniforms when values actually change
        if (matAny.uniforms.uTriplanarDetail.value !== triplanarDetail) {
          matAny.uniforms.uTriplanarDetail.value = triplanarDetail;
        }

        const shaderFogEnabledF = shaderFogEnabled ? 1.0 : 0.0;
        if (matAny.uniforms.uShaderFogEnabled.value !== shaderFogEnabledF) {
          matAny.uniforms.uShaderFogEnabled.value = shaderFogEnabledF;
        }

        if (matAny.uniforms.uShaderFogStrength.value !== shaderFogStrength) {
          matAny.uniforms.uShaderFogStrength.value = shaderFogStrength;
        }

        const wetnessEnabledF = wetnessEnabled ? 1.0 : 0.0;
        if (matAny.uniforms.uWetnessEnabled.value !== wetnessEnabledF) {
          matAny.uniforms.uWetnessEnabled.value = wetnessEnabledF;
        }

        const mossEnabledF = mossEnabled ? 1.0 : 0.0;
        if (matAny.uniforms.uMossEnabled.value !== mossEnabledF) {
          matAny.uniforms.uMossEnabled.value = mossEnabledF;
        }

        if (matAny.uniforms.uRoughnessMin.value !== roughnessMin) {
          matAny.uniforms.uRoughnessMin.value = roughnessMin;
        }

        matAny.polygonOffset = polygonOffsetEnabled;
        matAny.polygonOffsetFactor = polygonOffsetFactor;
        matAny.polygonOffsetUnits = polygonOffsetUnits;
        matAny.wireframe = wireframe;

        const viewMap: Record<string, number> = { off: 0, snow: 1, grass: 2, snowMinusGrass: 3, dominant: 4 };
        const nextWeightsView = viewMap[weightsView] ?? 0;
        if (matAny.uniforms.uWeightsView.value !== nextWeightsView) {
          matAny.uniforms.uWeightsView.value = nextWeightsView;
        }

        matAny.fog = threeFogEnabled;
        matAny.uniforms.uWaterLevel.value = waterLevel;

        const hFogEnabled = heightFogEnabled ? 1.0 : 0.0;
        if (matAny.uniforms.uHeightFogEnabled.value !== hFogEnabled) {
          matAny.uniforms.uHeightFogEnabled.value = hFogEnabled;
        }
        if (matAny.uniforms.uHeightFogStrength.value !== heightFogStrength) {
          matAny.uniforms.uHeightFogStrength.value = heightFogStrength;
        }
        if (matAny.uniforms.uHeightFogRange.value !== heightFogRange) {
          matAny.uniforms.uHeightFogRange.value = heightFogRange;
        }
        if (matAny.uniforms.uHeightFogOffset.value !== heightFogOffset) {
          matAny.uniforms.uHeightFogOffset.value = heightFogOffset;
        }

        if (matAny.uniforms.uFogNear.value !== fogNear) {
          matAny.uniforms.uFogNear.value = fogNear;
        }
        if (matAny.uniforms.uFogFar.value !== fogFar) {
          matAny.uniforms.uFogFar.value = fogFar;
        }

        const fog = scene.fog as any;
        if (fog) {
          const colorHex = `#${fog.color.getHexString()}`;
          const lastFog = lastFogRef.current;
          // Scene fog color still drives the uFogColor uniform for atmosphere matching
          if (!lastFog || lastFog.colorHex !== colorHex) {
            matAny.uniforms.uFogColor.value.copy(fog.color);
            lastFogRef.current = { near: fog.near ?? 20, far: fog.far ?? 160, colorHex };
          }
        }
      }
    });

    return <primitive object={mat} attach="material" />;
  };
