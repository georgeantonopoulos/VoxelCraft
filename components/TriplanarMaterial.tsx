import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '../utils/sharedResources';

const vertexShader = `
  attribute float aVoxelMat;
  attribute float aVoxelMat2;
  attribute float aVoxelMat3;
  attribute vec3 aWeight;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;

  flat varying float vMaterial1;
  flat varying float vMaterial2;
  flat varying float vMaterial3;
  varying vec3 vW;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vMaterial1 = aVoxelMat;
    vMaterial2 = aVoxelMat2;
    vMaterial3 = aVoxelMat3;
    vW = aWeight;
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

  flat varying float vMaterial1;
  flat varying float vMaterial2;
  flat varying float vMaterial3;
  varying vec3 vW;
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

  struct MatInfo {
      vec3 baseCol;
      float roughness;
      float noiseFactor;
  };

  MatInfo getMaterialInfo(float m, vec4 nMid, vec4 nHigh) {
      vec3 baseCol = uColorStone;
      float roughness = 0.8;
      float noiseFactor = 0.0;

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
      return MatInfo(baseCol, roughness, noiseFactor);
  }

  void main() {
    // 1. Apply Safe Normalization immediately
    vec3 N = safeNormalize(vWorldNormal);

    // 2. Use the safe normal for sampling
    vec4 nMid = getTriplanarNoise(N, 0.15);
    vec4 nHigh = getTriplanarNoise(N, 0.6);

    // 1. Sample Low-Frequency "Warp" Noise
    float warp = texture(uNoiseTexture, vWorldPosition * 0.05).r;

    // 2. Distort the Linear Weights
    vec3 warpedW = vW + (warp - 0.5) * 0.3;

    // 3. Soft-Max Blending
    vec3 softW = pow(max(warpedW, 0.0), vec3(4.0));

    // 4. Renormalize
    softW /= (softW.x + softW.y + softW.z + 0.0001);

    // 5. Conditional Sampling & Blending
    MatInfo m1 = getMaterialInfo(vMaterial1, nMid, nHigh);

    vec3 finalBaseCol = m1.baseCol * softW.x;
    float finalRoughness = m1.roughness * softW.x;
    float finalNoiseFactor = m1.noiseFactor * softW.x;

    if (softW.y > 0.001) {
        MatInfo m2 = getMaterialInfo(vMaterial2, nMid, nHigh);
        finalBaseCol += m2.baseCol * softW.y;
        finalRoughness += m2.roughness * softW.y;
        finalNoiseFactor += m2.noiseFactor * softW.y;
    }

    if (softW.z > 0.001) {
        MatInfo m3 = getMaterialInfo(vMaterial3, nMid, nHigh);
        finalBaseCol += m3.baseCol * softW.z;
        finalRoughness += m3.roughness * softW.z;
        finalNoiseFactor += m3.noiseFactor * softW.z;
    }

    float intensity = 0.6 + 0.6 * finalNoiseFactor;
    vec3 col = finalBaseCol * intensity;

    // --- Overlays ---
    // Use dominant material (m1) for moss logic trigger
    if (vMossiness > 0.1 || vMaterial1 >= 9.5) {
        vec3 mossColor = uColorMoss;
        float mossNoise = nHigh.g;
        mossColor *= (0.8 + 0.4 * mossNoise);
        float mossAmount = vMossiness;
        if (vMaterial1 >= 9.5) mossAmount = max(mossAmount, 0.35);
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

    // Adjust roughness
    finalRoughness -= (nHigh.r * 0.1);
    finalRoughness = mix(finalRoughness, 0.2, vWetness);
    // Force roughness for water-like (if exists)
    if (vMaterial1 >= 8.0 && vMaterial1 < 9.5) finalRoughness = 0.1;
    
    csm_Roughness = finalRoughness;
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
