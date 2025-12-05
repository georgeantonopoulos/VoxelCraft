import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';

const vertexShader = `
  attribute vec4 aMatWeightsA;
  attribute vec4 aMatWeightsB;
  attribute vec4 aMatWeightsC;
  attribute vec4 aMatWeightsD;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;

  varying vec4 vWa;
  varying vec4 vWb;
  varying vec4 vWc;
  varying vec4 vWd;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vWa = aMatWeightsA;
    vWb = aMatWeightsB;
    vWc = aMatWeightsC;
    vWd = aMatWeightsD;
    vWetness = aVoxelWetness;
    vMossiness = aVoxelMossiness;
    
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    
    csm_Position = position;
    csm_Normal = normal;
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
  // New Biomes
  uniform vec3 uColorRedSand;
  uniform vec3 uColorTerracotta;
  uniform vec3 uColorIce;
  uniform vec3 uColorJungleGrass;
  uniform vec3 uColorGlowStone;
  uniform vec3 uColorObsidian;

  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;

  varying vec4 vWa;
  varying vec4 vWb;
  varying vec4 vWc;
  varying vec4 vWd;
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
      float emission; // AAA: Added emission support
  };

  // Channel -> material mapping must match MATERIAL_CHANNELS in mesher.ts
  MatInfo getMatParams(int channel, vec4 nMid, vec4 nHigh) {
      vec3 baseCol = uColorStone;
      float roughness = 0.8;
      float noiseFactor = 0.0;
      float emission = 0.0;

      if (channel == 0) { // Air (no visible contribution)
          baseCol = vec3(0.0);
      }
      else if (channel == 1) { // Bedrock
          baseCol = uColorBedrock;
          noiseFactor = nMid.r;
      }
      else if (channel == 2) { // Stone
          baseCol = uColorStone;
          float cracks = nHigh.g;
          noiseFactor = mix(nMid.r, cracks, 0.5);
      }
      else if (channel == 3) { // Dirt
          baseCol = uColorDirt;
          noiseFactor = nMid.g;
      }
      else if (channel == 4) { // Grass
          baseCol = uColorGrass;
          float bladeNoise = nHigh.a;
          float patchNoise = nMid.r;
          noiseFactor = mix(bladeNoise, patchNoise, 0.3);
          baseCol *= vec3(1.0, 1.1, 1.0);
      }
      else if (channel == 5) { // Sand
          baseCol = uColorSand;
          noiseFactor = nHigh.a;
      }
      else if (channel == 6) { // Snow
          baseCol = uColorSnow;
          noiseFactor = nMid.r * 0.5 + 0.5;
      }
      else if (channel == 7) { // Clay
          baseCol = uColorClay;
          noiseFactor = nMid.g;
      }
      else if (channel == 8) { // Water (rarely used on terrain mesh)
          baseCol = uColorWater;
          roughness = 0.1;
      }
      else if (channel == 9) { // Mossy Stone
          baseCol = uColorStone; // Base is stone
          // Moss logic applied in overlay, but base color shifts slightly green
          noiseFactor = nMid.r;
      }
      else if (channel == 10) { // Red Sand
          baseCol = uColorRedSand;
          noiseFactor = nHigh.a;
      }
      else if (channel == 11) { // Terracotta
          baseCol = uColorTerracotta;
          noiseFactor = nMid.g;
          roughness = 0.95; // Matte
      }
      else if (channel == 12) { // Ice
          baseCol = uColorIce;
          noiseFactor = nMid.b * 0.5;
          roughness = 0.05; // Glassy
      }
      else if (channel == 13) { // Jungle Grass
          baseCol = uColorJungleGrass;
          noiseFactor = nHigh.a;
      }
      else if (channel == 14) { // Glow Stone
          baseCol = uColorGlowStone;
          noiseFactor = nMid.r + 0.5;
          emission = 2.0; // Bright!
      }
      else if (channel == 15) { // Obsidian
          baseCol = uColorObsidian;
          noiseFactor = nHigh.b * 0.3; // Subtle noise
          roughness = 0.15; // Very shiny/glassy
      }

      return MatInfo(baseCol, roughness, noiseFactor, emission);
  }

  void accumulateChannel(int channel, float weight, vec4 nMid, vec4 nHigh,
    inout vec3 accColor, inout float accRoughness, inout float accNoise, inout float accEmission, inout float totalW,
    inout int dominantChannel, inout float dominantWeight) {
    if (weight > 0.001) {
      MatInfo m = getMatParams(channel, nMid, nHigh);
      accColor += m.baseCol * weight;
      accRoughness += m.roughness * weight;
      accNoise += m.noiseFactor * weight;
      accEmission += m.emission * weight;
      totalW += weight;
      if (weight > dominantWeight) {
        dominantWeight = weight;
        dominantChannel = channel;
      }
    }
  }

  void main() {
    vec3 N = safeNormalize(vWorldNormal);
    vec4 nMid = getTriplanarNoise(N, 0.15);
    vec4 nHigh = getTriplanarNoise(N, 0.6);

    vec3 accColor = vec3(0.0);
    float accRoughness = 0.0;
    float accNoise = 0.0;
    float accEmission = 0.0;
    float totalW = 0.0;
    float dominantWeight = -1.0;
    int dominantChannel = 2; // default to stone

    accumulateChannel(0, vWa.x, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(1, vWa.y, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(2, vWa.z, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(3, vWa.w, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);

    accumulateChannel(4, vWb.x, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(5, vWb.y, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(6, vWb.z, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(7, vWb.w, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);

    accumulateChannel(8, vWc.x, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(9, vWc.y, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(10, vWc.z, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(11, vWc.w, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);

    accumulateChannel(12, vWd.x, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(13, vWd.y, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(14, vWd.z, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(15, vWd.w, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);

    if (totalW > 0.0001) {
      accColor /= totalW;
      accRoughness /= totalW;
      accNoise /= totalW;
      accEmission /= totalW;
    } else {
      accColor = uColorStone;
      accRoughness = 0.9;
      accNoise = 0.0;
    }

    float intensity = 0.6 + 0.6 * accNoise;
    vec3 col = accColor * intensity;

    // --- Overlays ---
    // AAA FIX: Ramp-based organic moss
    bool isMossyMat = (dominantChannel == 9);
    if (vMossiness > 0.1 || isMossyMat) {
        vec3 mossColor = uColorMoss;
        
        // Multi-scale noise for detail (Mid + High)
        float organicNoise = mix(nMid.r, nHigh.g, 0.4); 
        
        // Tangent growth simulation: use world Y normal to encourage top-growth
        // But for caves we want patches. The noise structure itself provides patches.
        
        float mossAmount = vMossiness;
        if (isMossyMat) mossAmount = max(mossAmount, 0.6); // Base mossiness for the material
        
        // Ramp check: smoothstep creates a hard but antialiased edge for the patch
        // We use the organic noise to modulate the threshold
        float threshold = 1.0 - mossAmount; // Higher moss = lower threshold = more moss
        // FIX: Widen the band for smoother transition (was 0.1 -> 0.4)
        float mossMix = smoothstep(threshold - 0.4, threshold + 0.4, organicNoise);

        col = mix(col, mossColor * (0.6 + 0.4 * nHigh.a), mossMix); // Blend with detail noise in color
        
        // Moss reduces roughness
        accRoughness = mix(accRoughness, 0.9, mossMix);
    }

    col = mix(col, col * 0.5, vWetness * 0.9);
    col = clamp(col, 0.0, 5.0);
    
    // Add Emission
    col += accEmission * accColor; 

    // Apply strong distance fog to blend toward the sky color and hide terrain generation
    float fogDist = length(vWorldPosition - cameraPosition);
    float fogAmt = clamp((fogDist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
    fogAmt = pow(fogAmt, 1.1); // slightly sharper transition for stronger fog
    col = mix(col, uFogColor, fogAmt * 0.9); // stronger fog intensity

    csm_DiffuseColor = vec4(col, uOpacity);
    csm_Emissive = vec3(accEmission * accColor); // Pass emissive to standard material

    // Adjust roughness
    accRoughness -= (nHigh.r * 0.1);
    accRoughness = mix(accRoughness, 0.2, vWetness);
    if (dominantChannel == 8) accRoughness = 0.1;
    
    csm_Roughness = accRoughness;
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
    uColorMoss: { value: new THREE.Color('#4a6b2f') }, // Tune: Darker organic green
    uColorBedrock: { value: new THREE.Color('#2a2a2a') },

    // New Colors (Tuned)
    uColorRedSand: { value: new THREE.Color('#d45d35') },
    uColorTerracotta: { value: new THREE.Color('#9e5e45') }, // Tune: Richer Earthy Red
    uColorIce: { value: new THREE.Color('#a3d9ff') },
    uColorJungleGrass: { value: new THREE.Color('#2e8b1d') },
    uColorGlowStone: { value: new THREE.Color('#00e5ff') }, // Tune: Cyan/Teal Luma
    uColorObsidian: { value: new THREE.Color('#0a0814') }, // Tune: Deepest Black/Purple

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
      // AAA FIX: Use FrontSide to prevent backface Z-fighting artifacts
      side={THREE.FrontSide}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
    />
  );
};
