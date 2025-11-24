import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '../utils/sharedResources';

// 1. Revert to GLSL 1.0 / Three.js Standard Syntax (attribute/varying)
const vertexShader = `
  attribute float aVoxelMat;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;

  varying float vMaterial;
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
    
    csm_Position = position;
  }
`;

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
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;

  varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  // --- THE FIX: Safe Normalization ---
  // Prevents NaNs (flashing) when normals cancel out in sharp valleys
  vec3 safeNormalize(vec3 v) {
      float len = length(v);
      if (len < 0.0001) return vec3(0.0, 1.0, 0.0);
      return v / len;
  }

  // Sharp Triplanar Sampler (GLSL 1 Compatible)
  vec4 getTriplanarNoise(vec3 normal, float scale) {
      vec3 blend = abs(normal);
      blend = normalize(max(blend, 0.00001));
      blend = pow(blend, vec3(8.0)); // Keep the sharp blending you liked
      blend /= dot(blend, vec3(1.0));

      vec3 p = vWorldPosition * scale;
      
      // Use standard 'texture' which Three.js handles
      vec4 xN = texture(uNoiseTexture, p.zyx);
      vec4 yN = texture(uNoiseTexture, p.xzy + vec3(100.0));
      vec4 zN = texture(uNoiseTexture, p.xyz + vec3(200.0));

      return xN * blend.x + yN * blend.y + zN * blend.z;
  }

  void main() {
    // 1. Apply Safe Normalization immediately
    vec3 N = safeNormalize(vWorldNormal);

    // --- Phase 1: Noise Thresholding ---
    // 1. Get interpolation noise (fixed in world space)
    float noise = texture(uNoiseTexture, vWorldPosition * 0.2).r;

    // 2. Distort the material value
    // (noise - 0.5) * 0.8 makes the transition border "wiggly"
    float noisyMat = vMaterial + (noise - 0.5) * 0.8;

    // 3. Snap to nearest integer (Hard Cut, but Organic Shape)
    float m = floor(noisyMat + 0.5);

    // 4. Clamp to prevent out-of-bounds errors
    m = clamp(m, 0.0, 10.0);

    // 2. Use the safe normal for sampling
    vec4 nMid = getTriplanarNoise(N, 0.15);
    vec4 nHigh = getTriplanarNoise(N, 0.6);

    vec3 baseCol = uColorStone;
    float roughness = 0.8;
    float noiseFactor = 0.0;

    // --- Material Logic (Restored) ---
    if (m < 1.5) {
        baseCol = uColorBedrock;
        noiseFactor = nMid.r;
    } 
    else if (m < 2.5) {
        baseCol = uColorStone;
        float cracks = nHigh.g;
        noiseFactor = mix(nMid.r, cracks, 0.5);
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

    // --- Overlays ---
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

    // Apply gentle distance fog to blend toward the sky color without hiding nearby terrain
    float fogDist = length(vWorldPosition - cameraPosition);
    float fogAmt = clamp((fogDist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
    fogAmt = pow(fogAmt, 1.25); // keep nearby detail crisp
    col = mix(col, uFogColor, fogAmt * 0.6);

    csm_DiffuseColor = vec4(col, uOpacity);

    roughness -= (nHigh.r * 0.1);
    roughness = mix(roughness, 0.2, vWetness);
    if (m >= 8.0 && m < 9.5) roughness = 0.1;
    
    csm_Roughness = roughness;
    csm_Metalness = 0.0;
  }
`;

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3; opacity?: number }> = ({ opacity = 1 }) => {
  const materialRef = useRef<any>(null);
  const { scene } = useThree();

  useFrame(() => {
    if (materialRef.current) {
      const mat = materialRef.current;
      mat.uniforms.uNoiseTexture.value = noiseTexture;
      mat.uniforms.uOpacity.value = opacity;
      const isTransparent = opacity < 0.999;
      mat.transparent = isTransparent;
      mat.depthWrite = !isTransparent;

      const fog = scene.fog as THREE.Fog | undefined;
      if (fog) {
        mat.uniforms.uFogColor.value.copy(fog.color);
        mat.uniforms.uFogNear.value = fog.near;
        mat.uniforms.uFogFar.value = fog.far;
      } else {
        mat.uniforms.uFogColor.value.set('#87CEEB');
        mat.uniforms.uFogNear.value = 1e6;
        mat.uniforms.uFogFar.value = 1e6 + 1.0;
      }
    }
  });

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
    uFogColor: { value: new THREE.Color('#87CEEB') },
    uFogNear: { value: 30 },
    uFogFar: { value: 400 },
    uOpacity: { value: 1 },
  }), []);

  return (
    <CustomShaderMaterial
      ref={materialRef}
      baseMaterial={THREE.MeshStandardMaterial}
      // REMOVED glslVersion to allow automatic compatibility
      roughness={0.9}
      metalness={0.0}
      depthWrite
      depthTest
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
    />
  );
};
