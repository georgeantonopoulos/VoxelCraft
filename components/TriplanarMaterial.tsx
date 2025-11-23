import * as THREE from 'three';
import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '../utils/sharedResources';

let loggedRendererInfo = false;

// 1. Vertex Shader
// We must declare attributes exactly as Three.js expects them if we override.
// CSM handles position/normal, we handle the custom data.
const vertexShader = `
  attribute float aVoxelMat;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;

  flat varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vMaterial = aVoxelMat;
    vWetness = aVoxelWetness;
    vMossiness = aVoxelMossiness;
    
    // Calculate world position manually for noise lookup
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;

    // Standard normal matrix calc
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    // CSM specific output.
    // CRITICAL: Do not transform 'position' here, CSM does that later.
    // We just pass the local position through.
    csm_Position = position;
  }
`;

// 2. Fragment Shader
const fragmentShader = `
  uniform sampler3D uNoiseTexture;
  uniform vec3 uColorStone;
  uniform vec3 uColorGrass;
  uniform vec3 uColorDirt;
  uniform vec3 uColorSand;
  uniform vec3 uColorSnow;
  uniform vec3 uColorWater;

  flat varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    // Re-normalize interpolated normals to prevent artifacts
    vec3 N = normalize(vWorldNormal);

    // Safety: Default color
    vec3 col = uColorStone;
    
    // Snap to nearest material ID to avoid "rainbow" gradients between materials
    float m = floor(vMaterial + 0.5);

    if (m < 2.0) col = uColorStone;
    else if (m < 3.0) col = uColorStone;
    else if (m < 4.0) col = uColorDirt;
    else if (m < 5.0) col = uColorGrass;
    else if (m < 6.0) col = uColorSand;
    else if (m < 7.0) col = uColorSnow;
    else if (m < 8.0) col = uColorDirt;
    else col = uColorWater;

    // Triplanar Noise (Macro + Detail)
    float nMacro = texture(uNoiseTexture, vWorldPosition * 0.04).r;
    float nDetail = texture(uNoiseTexture, vWorldPosition * 0.4).r;
    
    // Combine for visual interest (Contrast Boosted)
    float nCombined = mix(nMacro, nDetail, 0.5);
    col = col * (0.7 + 0.6 * nCombined); // Stronger contrast (0.7 to 1.3 multiplier)

    // Moss
    if (vMossiness > 0.1) {
        col = mix(col, vec3(0.15, 0.6, 0.1), vMossiness * 0.9);
    }

    // Wetness
    col = mix(col, col * 0.4, vWetness);

    // SAFETY: NaN Check (NaN comparisons return false)
    if (!(col.r >= 0.0)) col.r = 0.0;
    if (!(col.g >= 0.0)) col.g = 0.0;
    if (!(col.b >= 0.0)) col.b = 0.0;

    // SAFETY: Clamp colors to prevent HDR infinity crashes in PostProcessing
    // Cap at 5.0 to avoid Bloom explosions
    col = clamp(col, 0.0, 5.0);

    csm_DiffuseColor = vec4(col, 1.0);

    float roughness = mix(0.9, 0.2, vWetness);
    if (m >= 8.0) roughness = 0.05;

    csm_Roughness = roughness;
    csm_Metalness = 0.0;
  }
`;

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3 }> = () => {
  const materialRef = useRef<any>(null);
  const { gl } = useThree();
  const loggedRef = useRef(false);
  const programLoggedRef = useRef(false);

  useFrame(() => {
    if (materialRef.current) {
        materialRef.current.uniforms.uNoiseTexture.value = noiseTexture;
    }
  });

  useEffect(() => {
    if (loggedRef.current || loggedRendererInfo) return;
    const isWebGL2 = (gl as any).isWebGL2 || gl.capabilities?.isWebGL2;
    const max3D = (gl.capabilities as any)?.max3DTextureSize ?? (gl.capabilities as any)?.maxTextureSize;
    console.log('[TriplanarMaterial] Renderer info', {
      isWebGL2,
      supports3DTexture: Boolean((gl.capabilities as any)?.isWebGL2),
      max3DTextureSize: max3D,
      renderer: gl.getContext().constructor?.name
    });
    loggedRef.current = true;
    loggedRendererInfo = true;
  }, [gl]);

  const uniforms = useMemo(() => ({
    uNoiseTexture: { value: noiseTexture },
    uColorStone: { value: new THREE.Color('#888c8d') },
    uColorGrass: { value: new THREE.Color('#41a024') },
    uColorDirt: { value: new THREE.Color('#755339') },
    uColorSand: { value: new THREE.Color('#ebd89f') },
    uColorSnow: { value: new THREE.Color('#ffffff') },
    uColorWater: { value: new THREE.Color('#0099ff') },
  }), []);

  return (
    <CustomShaderMaterial
        ref={materialRef}
        baseMaterial={THREE.MeshStandardMaterial}
        roughness={0.9}
        metalness={0.0}
        // Explicit depth settings to ensure N8AO sees the mesh correctly
        depthWrite={true}
        depthTest={true}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        {...{
          onBeforeCompile: (shader: any) => {
            if (!programLoggedRef.current) {
              console.log('[TriplanarMaterial] onBeforeCompile', {
                vertexLength: shader.vertexShader?.length ?? 0,
                fragmentLength: shader.fragmentShader?.length ?? 0
              });
              programLoggedRef.current = true;
            }
          }
        } as any}
    />
  );
};
