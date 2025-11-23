import * as THREE from 'three';
import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '../utils/sharedResources';

let loggedRendererInfo = false;

// Vertex shader for CustomShaderMaterial
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
    
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    // Let CSM handle position transform
    csm_Position = position;
  }
`;

// Fragment shader (uses 3D procedural noise)
const fragmentShader = `
  uniform sampler3D uNoiseTexture;
  uniform vec3 uColorStone;
  uniform vec3 uColorGrass;
  uniform vec3 uColorDirt;
  uniform vec3 uColorSand;
  uniform vec3 uColorSnow;
  uniform vec3 uColorWater;
  uniform vec3 uColorClay;
  uniform vec3 uColorMoss;
  uniform vec3 uColorBedrock;

  // Feature Branch Varyings
  flat varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  // --- HELPERS ---

  // 1. Raw Noise Sample
  float getRawNoise(vec3 pos, float scale) {
      vec4 n = texture(uNoiseTexture, pos * scale * 0.05);
      // FBM reconstruction
      return n.r + n.g * 0.5 + n.b * 0.25 + n.a * 0.125;
  }

  // 2. Blended (Triplanar) Noise Sample
  // This solves the "texture stretching" on vertical walls
  float getBlendedNoise(vec3 pos, vec3 normal, float scale) {
      vec3 blend = abs(normal);
      // SHARPEN BLENDING: Power of 8.0 tightens the seam
      blend = normalize(max(blend, 0.00001));
      blend = pow(blend, vec3(8.0));
      blend /= dot(blend, vec3(1.0));

      // Offset planes to prevent mirroring artifacts
      float xN = getRawNoise(pos.zyx, scale);
      float yN = getRawNoise(pos.xzy + vec3(100.0), scale);
      float zN = getRawNoise(pos.xyz + vec3(200.0), scale);

      return xN * blend.x + yN * blend.y + zN * blend.z;
    }

  void main() {
    vec3 N = normalize(vWorldNormal);
    float m = floor(vMaterial + 0.5);

    // Macro Noise for large scale variation
    float macroNoise = getBlendedNoise(vWorldPosition, N, 0.05);

    // Base Palette Selection
    vec3 baseCol = uColorStone;

    // Material IDs (Manual map to avoid branching hell if possible, but if/else is fine here)
    if (m < 1.5) baseCol = uColorBedrock;
    else if (m < 2.5) baseCol = uColorStone;
    else if (m < 3.5) baseCol = uColorDirt;
    else if (m < 4.5) baseCol = uColorGrass;
    else if (m < 5.5) baseCol = uColorSand;
    else if (m < 6.5) baseCol = uColorSnow;
    else if (m < 7.5) baseCol = uColorClay;
    else if (m < 8.5) baseCol = uColorWater; // Water Source
    else if (m < 9.5) baseCol = uColorWater; // Water Flowing
    else baseCol = uColorMoss; // Mossy Stone

    // Detail Overlay
    // We modulate the base color with the high-frequency blended noise
    float detail = getBlendedNoise(vWorldPosition, N, 0.3);
    float intensity = 0.7 + 0.6 * detail; // Center around 1.0

    // Grass specific logic
    if (m >= 4.0 && m < 5.5) {
        // Mix some macro variation into grass
        baseCol = mix(baseCol, baseCol * 0.8 + vec3(0.1, 0.1, 0.0), macroNoise * 0.5);
    }

    vec3 col = baseCol * intensity;

    // --- ALIVE WORLD LAYERS ---

    // 1. Moss Overlay
    if (vMossiness > 0.1 || m >= 9.5) {
        float mossNoise = getBlendedNoise(vWorldPosition, N, 0.6);
        // Threshold logic for moss patches
        if (vMossiness + mossNoise * 0.2 > 0.4) {
             col = mix(col, uColorMoss * (0.8 + 0.4 * mossNoise), 0.8);
        }
    }

    // 2. Wetness (Darkening)
    col = mix(col, col * 0.5, vWetness * 0.8);

    // CRITICAL: Clamp to prevent NaNs/overflows
    col = clamp(col, 0.0, 5.0);

    // --- CSM OUTPUTS ---
    csm_DiffuseColor = vec4(col, 1.0);

    // Roughness Logic
    float roughness = 0.9;
    if (m >= 8.0) roughness = 0.1; // Water is shiny
    else roughness = mix(roughness, 0.2, vWetness); // Wet things are shiny

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
    uColorClay: { value: new THREE.Color('#a67b5b') },
    uColorMoss: { value: new THREE.Color('#5c8a3c') },
    uColorBedrock: { value: new THREE.Color('#2a2a2a') },
  }), []);

  return (
    <CustomShaderMaterial
      ref={materialRef}
      baseMaterial={THREE.MeshStandardMaterial}
      roughness={0.9}
      metalness={0.0}
      depthWrite
      depthTest
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
