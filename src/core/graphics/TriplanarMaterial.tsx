import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { noiseTexture } from '@core/memory/sharedResources';
import { sharedUniforms } from './SharedUniforms';

const vertexShader = `
  attribute vec4 aMatWeightsA;
  attribute vec4 aMatWeightsB;
  attribute vec4 aMatWeightsC;
  attribute vec4 aMatWeightsD;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;
  attribute float aVoxelCavity;

  uniform vec2 uWindDirXZ;
  uniform float uNormalStrength;

  varying vec4 vWa;
  varying vec4 vWb;
  varying vec4 vWc;
  varying vec4 vWd;
  varying float vWetness;
  varying float vMossiness;
  varying float vCavity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vDominantChannel;
  varying float vDominantWeight;

  vec2 safeNormalize2(vec2 v) {
    float len = length(v);
    if (len < 0.0001) return vec2(1.0, 0.0);
    return v / len;
  }

  // Procedural normal perturbation in the vertex stage.
  // NOTE: This is intentionally "macro" scale (large wavelengths) to avoid shimmer.
  vec3 applyDominantNormal(vec3 n, vec3 worldPos, float channel, float weight) {
    vec3 nn = normalize(n);
    vec2 wind = safeNormalize2(uWindDirXZ);

    // Weighting keeps blends stable (dominant materials get the strongest shape cue).
    float w = clamp(weight, 0.0, 1.0);
    float base = uNormalStrength * (0.35 + 0.65 * w);

    // Sand / Red Sand: wind-aligned ripples primarily on flatter surfaces.
    if (channel == 5.0 || channel == 10.0) {
      float flatness = pow(clamp(nn.y, 0.0, 1.0), 2.4);
      float freq = 2.8;
      float warp = sin(worldPos.x * 0.06 + worldPos.z * 0.05) * 0.55;
      float phase = dot(worldPos.xz, wind) * freq + warp;
      float c = cos(phase);
      vec3 g = vec3(wind.x, 0.0, wind.y);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (c * base * flatness * 0.35));
    }
    // Stone / Bedrock / Obsidian: subtle stratification bands.
    else if (channel == 2.0 || channel == 1.0 || channel == 15.0) {
      float freq = 1.4;
      float phase = worldPos.y * freq + sin(dot(worldPos.xz, vec2(0.04, 0.05))) * 0.65;
      float c = cos(phase);
      vec3 g = vec3(0.0, 1.0, 0.0);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (c * base * 0.18));
    }
    // Dirt / Clay / Terracotta: clumpy surface cue.
    else if (channel == 3.0 || channel == 7.0 || channel == 11.0) {
      float fx = 1.05;
      float fz = 0.95;
      float sx = sin(worldPos.x * fx);
      float sz = sin(worldPos.z * fz);
      vec3 g = vec3(cos(worldPos.x * fx) * sz, 0.0, sx * cos(worldPos.z * fz));
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (base * 0.06));
    }
    // Grass / Jungle Grass: very subtle fiber direction cue.
    else if (channel == 4.0 || channel == 13.0) {
      float phase = dot(worldPos.xz, wind.yx) * 2.2 + worldPos.y * 0.4;
      float c = cos(phase);
      vec3 g = vec3(wind.y, 0.0, wind.x);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (c * base * 0.05));
    }
    // Snow / Ice: extremely subtle micro undulation (kept tiny to avoid sparkle shimmer).
    else if (channel == 6.0 || channel == 12.0) {
      float phase = worldPos.x * 1.8 + worldPos.z * 2.0;
      float c = cos(phase);
      vec3 g = vec3(1.0, 0.0, 1.0);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (c * base * 0.02));
    }

    return nn;
  }

  void main() {
    vWa = aMatWeightsA;
    vWb = aMatWeightsB;
    vWc = aMatWeightsC;
    vWd = aMatWeightsD;
    vWetness = aVoxelWetness;
    vMossiness = aVoxelMossiness;
    vCavity = aVoxelCavity;
    
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    // Find dominant channel for stable, low-shimmer procedural detail.
    float wMax = vWa.x; float ch = 0.0;
    if (vWa.y > wMax) { wMax = vWa.y; ch = 1.0; }
    if (vWa.z > wMax) { wMax = vWa.z; ch = 2.0; }
    if (vWa.w > wMax) { wMax = vWa.w; ch = 3.0; }
    if (vWb.x > wMax) { wMax = vWb.x; ch = 4.0; }
    if (vWb.y > wMax) { wMax = vWb.y; ch = 5.0; }
    if (vWb.z > wMax) { wMax = vWb.z; ch = 6.0; }
    if (vWb.w > wMax) { wMax = vWb.w; ch = 7.0; }
    if (vWc.x > wMax) { wMax = vWc.x; ch = 8.0; }
    if (vWc.y > wMax) { wMax = vWc.y; ch = 9.0; }
    if (vWc.z > wMax) { wMax = vWc.z; ch = 10.0; }
    if (vWc.w > wMax) { wMax = vWc.w; ch = 11.0; }
    if (vWd.x > wMax) { wMax = vWd.x; ch = 12.0; }
    if (vWd.y > wMax) { wMax = vWd.y; ch = 13.0; }
    if (vWd.z > wMax) { wMax = vWd.z; ch = 14.0; }
    if (vWd.w > wMax) { wMax = vWd.w; ch = 15.0; }
    vDominantChannel = ch;
    vDominantWeight = wMax;
    
    csm_Position = position;
    // Procedural macro normal perturbation (kept in vertex to stay stable in motion).
    csm_Normal = applyDominantNormal(normal, vWorldPosition, vDominantChannel, vDominantWeight);
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
	  // Debug: 0..1 slider to reduce high-frequency triplanar noise (helps diagnose shimmer).
	  uniform float uTriplanarDetail;
	  // Debug: allow isolating fog-related artifacts (banding/flicker) by disabling shader fog.
	  uniform float uShaderFogEnabled;
	  uniform float uShaderFogStrength;
	  // Debug: isolate overlay-driven shimmer (wetness darkening/roughness, moss overlay).
	  uniform float uWetnessEnabled;
	  uniform float uMossEnabled;
	  uniform float uRoughnessMin;
	  // Debug: visualize weight attributes to spot discontinuities at chunk seams.
	  // 0 = off, 1 = snow, 2 = grass, 3 = snowMinusGrass, 4 = dominant
	  uniform int uWeightsView;
	  // Procedural detail controls (kept as uniforms for future tuning).
	  uniform float uMacroStrength;
	  uniform float uCavityStrength;
	  uniform vec2 uWindDirXZ;
	  uniform float uNormalStrength;
    
    // Caustics Uniforms
    uniform float uTime;
    uniform vec3 uSunDirection;
    uniform float uWaterLevel;

  varying vec4 vWa;
  varying vec4 vWb;
  varying vec4 vWc;
  varying vec4 vWd;
  varying float vWetness;
  varying float vMossiness;
  varying float vCavity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vDominantChannel;
  varying float vDominantWeight;

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
      blend = pow(blend, vec3(4.0)); // Soften blending (was 8.0) to fix flickering artifact
      blend /= dot(blend, vec3(1.0));

      vec3 p = vWorldPosition * scale;
      
      // Use standard 'texture' which Three.js handles
      vec4 xN = texture(uNoiseTexture, p.zyx);
      vec4 yN = texture(uNoiseTexture, p.xzy + vec3(100.0));
      vec4 zN = texture(uNoiseTexture, p.xyz + vec3(200.0));

      return xN * blend.x + yN * blend.y + zN * blend.z;
  }

  vec2 safeNormalize2(vec2 v) {
      float len = length(v);
      if (len < 0.0001) return vec2(1.0, 0.0);
      return v / len;
  }

  // Helper to sample the base web/shimmer pattern
  float sampleCausticPattern(vec2 uv, float ang, float tz1, float tz2) {
      // Use integer frequencies to ensure perfect looping at the 2PI boundary
      vec2 flow1 = vec2(cos(ang), sin(ang)) * 0.5;
      vec2 flow2 = vec2(cos(ang * 2.0 + 1.0), sin(ang * 2.0 + 1.0)) * 0.3;

      // Layer 1: Macro Web (Ridged)
      vec3 p1a = vec3(uv * 0.7 + flow1, tz1);
      vec3 p1b = vec3(uv * 0.7 - flow1, tz2);
      float n1a = texture(uNoiseTexture, p1a).r;
      float n1b = texture(uNoiseTexture, p1b).r;
      // High exponent (10.0) for cleaner, thinner lines (less "busy")
      float r1 = pow(1.0 - abs(min(n1a, n1b) - 0.5) * 2.0, 10.0);

      // Layer 2: Micro Shimmer (High Frequency) - significantly reduced in weight
      vec3 p2a = vec3(uv * 2.5 + flow2, tz2);
      vec3 p2b = vec3(uv * 2.5 - flow2, tz1);
      float n2a = texture(uNoiseTexture, p2a).r;
      float n2b = texture(uNoiseTexture, p2b).r;
      float r2 = pow(1.0 - abs(min(n2a, n2b) - 0.5) * 2.0, 12.0);

      return r1 * 0.4 + r2 * 0.05;
  }

  // Fast procedural caustics pattern with dispersion and layering
  vec3 getRealisticCaustics(vec3 pos, vec3 sunDir, float t) {
      const float TWO_PI = 6.28318530718;
      const float CAUSTICS_LOOP_SECONDS = 20.0;
      // Halved speed as requested
      float lt = mod(t * 0.5, CAUSTICS_LOOP_SECONDS);
      float ang = (lt / CAUSTICS_LOOP_SECONDS) * TWO_PI;

      // Projection (Refraction Approx)
      vec3 lightDir = normalize(vec3(sunDir.x, sunDir.y + 0.5, sunDir.z));
      float distToSurface = uWaterLevel - pos.y;
      vec2 uv = (pos.xz - lightDir.xz * (distToSurface / max(0.2, lightDir.y))) * 0.45;
      
      // Integer frequency for time-plane coordinates
      float tz1 = 0.5 + 0.5 * sin(ang);
      float tz2 = 0.5 + 0.5 * cos(ang);

      // Chromatic Aberration / Dispersion (Scale-based)
      float disp = 0.012; 
      
      float r = sampleCausticPattern(uv * (1.0 + disp), ang, tz1, tz2);
      float g = sampleCausticPattern(uv, ang, tz1, tz2);
      float b = sampleCausticPattern(uv * (1.0 - disp), ang, tz1, tz2);

      // Mix for white core: where they overlap, we get additive white
      vec3 finalC = vec3(r, g, b);
      
      // Boost core intensity
      float overlap = min(r, min(g, b));
      finalC += overlap * 1.5;

      // Visibility reduced to roughly 1/3 of previous (was 18.0)
      finalC *= 6.0; 
      
      // Depth-based intensity
      float depthFade = exp(-distToSurface * 0.18); 
      return finalC * depthFade;
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
	    float highScale = mix(0.15, 0.6, clamp(uTriplanarDetail, 0.0, 1.0));
	    vec4 nHigh = getTriplanarNoise(N, highScale);
	    // Volume-sampled macro noise (1 fetch) for large-scale tint/roughness variation.
	    vec4 nMacro = texture(uNoiseTexture, vWorldPosition * 0.012 + vec3(0.11, 0.07, 0.03));
	    float macro = (nMacro.r * 2.0 - 1.0) * clamp(uMacroStrength, 0.0, 2.0);

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

	    // Debug views (material weights)
	    // Channel mapping: Grass = 4 (vWb.x), Snow = 6 (vWb.z)
	    if (uWeightsView != 0) {
	      float grassW = vWb.x;
	      float snowW = vWb.z;
	      if (uWeightsView == 1) {
	        col = vec3(snowW);
	      } else if (uWeightsView == 2) {
	        col = vec3(grassW);
	      } else if (uWeightsView == 3) {
	        float v = clamp((snowW - grassW) * 2.0 + 0.5, 0.0, 1.0);
	        col = vec3(v);
	      } else if (uWeightsView == 4) {
	        // Dominant among a few common surface channels: stone(2), dirt(3), grass(4), snow(6)
	        float stoneW = vWa.z;
	        float dirtW = vWa.w;
	        float maxW = stoneW;
	        vec3 c = vec3(0.5); // stone gray
	        if (dirtW > maxW) { maxW = dirtW; c = vec3(0.35, 0.25, 0.15); }
	        if (grassW > maxW) { maxW = grassW; c = vec3(0.1, 0.6, 0.1); }
	        if (snowW > maxW) { maxW = snowW; c = vec3(0.9); }
	        col = c;
	      }
	      csm_DiffuseColor = vec4(col, uOpacity);
	      csm_Emissive = vec3(0.0);
	      csm_Roughness = 1.0;
	      csm_Metalness = 0.0;
	      return;
	    }

    // --- Overlays ---
    // AAA FIX: Ramp-based organic moss
    // Check Channel 9 weight directly (vWc.y) for smooth blending instead of binary dominant check
    float mossMatWeight = vWc.y; 
    
    // Combine simulation mossiness with painted moss material
    float effectiveMoss = max(vMossiness, mossMatWeight);

	    if (uMossEnabled > 0.5 && effectiveMoss > 0.001) {
	        vec3 mossColor = uColorMoss;
        
        // Multi-scale noise for detail (Mid + High)
        float organicNoise = mix(nMid.r, nHigh.g, 0.4); 
        
        // Tangent growth simulation: use world Y normal to encourage top-growth
        // But for caves we want patches. The noise structure itself provides patches.
        
        // Ramp check: smoothstep creates a hard but antialiased edge for the patch
        // We use the organic noise to modulate the threshold
        float threshold = 1.0 - effectiveMoss; // Higher moss = lower threshold = more moss
        
        // FIX: Widen the band for smoother transition (was 0.1 -> 0.4)
        float mossMix = smoothstep(threshold - 0.4, threshold + 0.4, organicNoise);

        col = mix(col, mossColor * (0.6 + 0.4 * nHigh.a), mossMix); // Blend with detail noise in color
        
        // Moss reduces roughness
        accRoughness = mix(accRoughness, 0.9, mossMix);
    }

	    if (uWetnessEnabled > 0.5) {
	      col = mix(col, col * 0.5, vWetness * 0.9);
	    }

	    // --- Macro Variation (all materials) ---
	    // Breaks up large flat plains without adding extra texture lookups.
	    col *= (1.0 + macro * 0.06);
	    accRoughness += macro * 0.05;

	    // --- Material-Specific Patterns (dominant material for stability) ---
	    // We lean on dominant channel to avoid high-frequency shimmer when weights blend.
	    int dom = int(floor(vDominantChannel + 0.5));
	    vec2 wind = safeNormalize2(uWindDirXZ);
	    if (dom == 5 || dom == 10) {
	      // Sand / Red Sand: dune ripples + mottling.
	      float rip = sin(dot(vWorldPosition.xz, wind) * 2.8 + (nMacro.g * 2.0 - 1.0) * 0.6);
	      float mott = (nMid.g * 2.0 - 1.0);
	      col *= 1.0 + (rip * 0.03 + mott * 0.02);
	      accRoughness = mix(accRoughness, 0.92, 0.35);
	    } else if (dom == 2 || dom == 1 || dom == 15) {
	      // Stone / Bedrock / Obsidian: strata bands + crack veining.
	      float bands = sin(vWorldPosition.y * 1.4 + (nMacro.b * 2.0 - 1.0) * 1.2);
	      float cracks = pow(1.0 - abs(nHigh.g * 2.0 - 1.0), 3.5);
	      col *= 1.0 + bands * 0.02;
	      col *= 1.0 - cracks * 0.08;
	      accRoughness += cracks * 0.08;
	    } else if (dom == 3 || dom == 7 || dom == 11) {
	      // Dirt / Clay / Terracotta: clumps + darker cavities.
	      float clump = (nHigh.r * 2.0 - 1.0);
	      col *= 1.0 + clump * 0.03;
	      col *= 1.0 - smoothstep(0.2, 0.9, abs(clump)) * 0.06;
	      accRoughness = mix(accRoughness, 0.95, 0.15);
	    } else if (dom == 6) {
	      // Snow: softer diffuse + higher roughness, slight blue shift.
	      col = mix(col, col * vec3(0.92, 0.96, 1.04), 0.22);
	      accRoughness = mix(accRoughness, 0.98, 0.45);
	    } else if (dom == 12) {
	      // Ice: glassy but not mirror-shiny; keep it smooth and slightly blue.
	      col = mix(col, col * vec3(0.92, 0.98, 1.06), 0.18);
	      accRoughness = mix(accRoughness, 0.12, 0.35);
	    } else if (dom == 14) {
	      // Glow stone: subtle mottling so emission isn't a flat fill.
	      col *= 1.0 + (nMacro.a * 2.0 - 1.0) * 0.03;
	    } else if (dom == 4 || dom == 13) {
	      // Grass / Jungle Grass: patchy color variation.
	      float patchiness = (nMacro.g * 2.0 - 1.0);
	      col *= 1.0 + patchiness * 0.03;
	    }

	    // --- Cavity Darkening (micro-AO) ---
	    float cav = clamp(vCavity, 0.0, 1.0) * clamp(uCavityStrength, 0.0, 2.0);
	    col *= mix(1.0, 0.65, cav);
	    accRoughness = mix(accRoughness, 1.0, cav * 0.25);

	    col = clamp(col, 0.0, 5.0);
    
    // Add Emission
    col += accEmission * accColor; 

    // --- Caustics (Underwater Ground) ---
    // Only applied if below water level, sun is up, AND surface is wet (proxy for submerged)
    // Use vWetness > 0.05 to ensure caustics only render on surfaces that are actually in water.
    // This prevents them appearing in dry caves that are below sea level.
    if (vWetness > 0.05 && vWorldPosition.y < uWaterLevel && uSunDirection.y > 0.0) {
        float waterDepth = uWaterLevel - vWorldPosition.y;
        
        // Mask: strong near surface, fade deep down
        float depthMask = smoothstep(60.0, 0.0, waterDepth);
        // Mask: must be somewhat facing up to catch light
        float normalMask = clamp(dot(N, uSunDirection), 0.0, 1.0);
        // Mask: Cavity check (vCavity > 0.3 means cave).
        float openMask = 1.0 - smoothstep(0.0, 0.3, vCavity);
        // Mask: Floor check (Fixes vertical stretching by hiding caustics on walls)
        float floorMask = smoothstep(0.25, 0.65, N.y);
        
        if (depthMask > 0.01 && normalMask > 0.01 && openMask > 0.01 && floorMask > 0.01) {
             vec3 caus = getRealisticCaustics(vWorldPosition, uSunDirection, uTime);
             
             // Secondary Mask: Large scale variation to break up uniformity
             float variation = texture(uNoiseTexture, vec3(vWorldPosition.xz * 0.008, 0.0)).b;
             float variationMask = smoothstep(0.35, 0.65, variation);

             // Final Composite: 
             // We removed the teal tint; the dispersion itself provides realistic color.
             // We add a tiny baseline of blue to simulate the water's medium.
             vec3 finalCaustic = caus * depthMask * normalMask * openMask * floorMask * variationMask;
             col += finalCaustic * 0.3; 
        }
    } 

	    // Apply strong distance fog to blend toward the sky color and hide terrain generation.
	    // Note: Three.js base fog may also be enabled on the material; use debug toggles to isolate stacking.
	    if (uShaderFogEnabled > 0.5) {
	      float fogDist = length(vWorldPosition - cameraPosition);
	      float fogAmt = clamp((fogDist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
	      fogAmt = pow(fogAmt, 1.1); // slightly sharper transition for stronger fog
	      col = mix(col, uFogColor, fogAmt * uShaderFogStrength);
	    }

    csm_DiffuseColor = vec4(col, clamp(uOpacity, 0.0, 1.0));
    csm_Emissive = vec3(accEmission * accColor); // Pass emissive to standard material

	    // Adjust roughness
	    accRoughness -= (nHigh.r * 0.1);
	    if (uWetnessEnabled > 0.5) {
	      accRoughness = mix(accRoughness, 0.2, vWetness);
	    }
	    // Debug: clamp minimum roughness to reduce specular aliasing/shimmer in motion.
	    accRoughness = max(accRoughness, clamp(uRoughnessMin, 0.0, 1.0));
	    if (dominantChannel == 8) accRoughness = 0.1;
    
    csm_Roughness = accRoughness;
    csm_Metalness = 0.0;

  }
`;

// Shared material instance to avoid redundant shader compilation/patching per chunk.
// All chunks share this material; variety is provided by geometry attributes (wetness, spawnTime, etc.).
let sharedTerrainMaterial: THREE.MeshStandardMaterial | null = null;

const getSharedTerrainMaterial = () => {
  if (sharedTerrainMaterial) return sharedTerrainMaterial;

  const uniforms = {
    ...sharedUniforms,
    uNoiseTexture: { value: noiseTexture },
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
}) => {
    const { scene } = useThree();
    const lastFogRef = useRef<{ near: number; far: number; colorHex: string } | null>(null);

    const mat = useMemo(() => getSharedTerrainMaterial(), []);

    useFrame(() => {
      const matAny = mat as any;
      if (!matAny) return;

      // Keep shared noise up to date
      if (matAny.uniforms.uNoiseTexture.value !== noiseTexture) matAny.uniforms.uNoiseTexture.value = noiseTexture;

      // Avoid per-frame churn: only touch uniforms when values actually change
      if (matAny.uniforms.uTriplanarDetail.value !== triplanarDetail) matAny.uniforms.uTriplanarDetail.value = triplanarDetail;
      const shaderFogEnabledF = shaderFogEnabled ? 1.0 : 0.0;
      if (matAny.uniforms.uShaderFogEnabled.value !== shaderFogEnabledF) matAny.uniforms.uShaderFogEnabled.value = shaderFogEnabledF;
      if (matAny.uniforms.uShaderFogStrength.value !== shaderFogStrength) matAny.uniforms.uShaderFogStrength.value = shaderFogStrength;
      const wetnessEnabledF = wetnessEnabled ? 1.0 : 0.0;
      if (matAny.uniforms.uWetnessEnabled.value !== wetnessEnabledF) matAny.uniforms.uWetnessEnabled.value = wetnessEnabledF;
      const mossEnabledF = mossEnabled ? 1.0 : 0.0;
      if (matAny.uniforms.uMossEnabled.value !== mossEnabledF) matAny.uniforms.uMossEnabled.value = mossEnabledF;
      if (matAny.uniforms.uRoughnessMin.value !== roughnessMin) matAny.uniforms.uRoughnessMin.value = roughnessMin;

      matAny.polygonOffset = polygonOffsetEnabled;
      matAny.polygonOffsetFactor = polygonOffsetFactor;
      matAny.polygonOffsetUnits = polygonOffsetUnits;
      matAny.wireframe = wireframe;

      const viewMap: Record<string, number> = { off: 0, snow: 1, grass: 2, snowMinusGrass: 3, dominant: 4 };
      const nextWeightsView = viewMap[weightsView] ?? 0;
      if (matAny.uniforms.uWeightsView.value !== nextWeightsView) matAny.uniforms.uWeightsView.value = nextWeightsView;
      matAny.fog = threeFogEnabled;

      matAny.uniforms.uWaterLevel.value = waterLevel;

      const fog = scene.fog as THREE.Fog | undefined;
      if (fog) {
        const colorHex = `#${fog.color.getHexString()}`;
        const lastFog = lastFogRef.current;
        if (!lastFog || lastFog.near !== fog.near || lastFog.far !== fog.far || lastFog.colorHex !== colorHex) {
          matAny.uniforms.uFogColor.value.copy(fog.color);
          matAny.uniforms.uFogNear.value = fog.near;
          matAny.uniforms.uFogFar.value = fog.far;
          lastFogRef.current = { near: fog.near, far: fog.far, colorHex };
        }
      }
    });

    return <primitive object={mat} attach="material" />;
  };
