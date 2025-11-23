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

  precision highp float;
  precision highp sampler3D;

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

  // Standard Varyings
  flat varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  // --- HELPERS ---

  // Robust normalization to prevent NaNs on degenerate geometry/concave interpolation
  vec3 safeNormalize(vec3 v) {
      float len = length(v);
      if (len < 0.0001) return vec3(0.0, 1.0, 0.0);
      return v / len;
  }

  // Sharp Triplanar Sampler
  // UPDATED: Accepts 'normal' argument to use the safe normal from main()
  vec4 getTriplanarNoise(vec3 normal, float scale) {
      vec3 blend = abs(normal);
      blend = normalize(max(blend, 0.00001));
      blend = pow(blend, vec3(8.0));
      blend /= dot(blend, vec3(1.0));

      vec3 p = vWorldPosition * scale;
      vec4 xN = texture(uNoiseTexture, p.zyx);
      vec4 yN = texture(uNoiseTexture, p.xzy + vec3(100.0));
      vec4 zN = texture(uNoiseTexture, p.xyz + vec3(200.0));

      return xN * blend.x + yN * blend.y + zN * blend.z;
  }

  void main() {
    // 1. Calculate Safe Normal immediately
    vec3 N = safeNormalize(vWorldNormal);
    float m = floor(vMaterial + 0.5);

    // 2. Pass 'N' to noise functions
    vec4 nMid = getTriplanarNoise(N, 0.15);
    vec4 nHigh = getTriplanarNoise(N, 0.6);

    vec3 baseCol = uColorStone;
    float roughness = 0.8;
    float noiseFactor = 0.0;

    if (m < 1.5) {
        baseCol = uColorBedrock;
        noiseFactor = nMid.r;
    } 
    else if (m < 2.5) {
        baseCol = uColorStone;
        float structure = nMid.r;
        float cracks = nHigh.g;
        noiseFactor = mix(structure, cracks, 0.5);
    } 
    else if (m < 3.5) {
        baseCol = uColorDirt;
        noiseFactor = nMid.g;
    } 
    else if (m < 4.5) {
        baseCol = uColorGrass;
        float bladeNoise = nHigh.a;
        float patchNoise = nMid.r;
        noiseFactor = mix(bladeNoise, patchNoise, 0.3);
        baseCol *= vec3(1.0, 1.1, 1.0);
    } 
    else if (m < 5.5) {
        baseCol = uColorSand;
        noiseFactor = nHigh.a;
    } 
    else if (m < 6.5) {
        baseCol = uColorSnow;
        noiseFactor = nMid.r * 0.5 + 0.5;
    } 
    else if (m < 7.5) {
        baseCol = uColorClay;
        noiseFactor = nMid.g;
    } 
    else if (m < 9.5) {
        baseCol = uColorWater;
        roughness = 0.1;
    } 
    else {
        baseCol = uColorMoss;
        noiseFactor = nMid.r;
    }

    float intensity = 0.6 + 0.6 * noiseFactor;
    vec3 col = baseCol * intensity;

    if (vMossiness > 0.1 || m >= 9.5) {
        vec3 mossColor = uColorMoss;
        float mossNoise = nHigh.g;
        mossColor *= (0.8 + 0.4 * mossNoise);
        
        float mossAmount = vMossiness;
        if (m >= 9.5) mossAmount = max(mossAmount, 0.35);
        
        float mossMix = smoothstep(0.3, 0.6, mossAmount + mossNoise * 0.2);
        col = mix(col, mossColor, mossMix);
    }

    col = mix(col, col * 0.5, vWetness * 0.9);
    col = clamp(col, 0.0, 5.0);

    csm_DiffuseColor = vec4(col, 1.0);

    roughness -= (nHigh.r * 0.1);
    roughness = mix(roughness, 0.2, vWetness);
    if (m >= 8.0 && m < 9.5) roughness = 0.1;
    
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
