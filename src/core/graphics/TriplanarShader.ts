export const triplanarVertexShader = `
  attribute vec4 aMatWeightsA;
  attribute vec4 aMatWeightsB;
  attribute vec4 aMatWeightsC;
  attribute vec4 aMatWeightsD;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;
  attribute float aVoxelCavity;
  attribute vec3 aLightColor;  // Per-vertex GI light from light grid

  uniform vec2 uWindDirXZ;
  uniform float uNormalStrength;
  uniform float uTime;

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
  varying vec3 vLightColor;  // Pass GI light to fragment shader

  vec2 safeNormalize2(vec2 v) {
    float len = length(v);
    if (len < 0.0001) return vec2(1.0, 0.0);
    return v / len;
  }

  // === PHASE 2: Optimized procedural noise for vertex normals ===
  // Single hash - extremely cheap
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  // Cheap pseudo-random based on position (no loops, no texture lookups)
  float cheapNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // Smoothstep
    // Just 4 hash samples instead of 8 - interpolate XZ, use Y directly
    float a = hash31(i);
    float b = hash31(i + vec3(1.0, 0.0, 0.0));
    float c = hash31(i + vec3(0.0, 0.0, 1.0));
    float d = hash31(i + vec3(1.0, 0.0, 1.0));
    float xz = mix(mix(a, b, f.x), mix(c, d, f.x), f.z);
    // Blend with Y-offset sample for 3D variation
    float yOff = hash31(i + vec3(0.0, 1.0, 0.0));
    return mix(xz, yOff, f.y * 0.5);
  }

  vec3 applyDominantNormal(vec3 n, vec3 worldPos, float channel, float weight) {
    vec3 nn = normalize(n);
    vec2 wind = safeNormalize2(uWindDirXZ);
    float w = clamp(weight, 0.0, 1.0);
    float base = uNormalStrength * (0.6 + 0.4 * w);

    // Slope factors
    float flatness = clamp(nn.y, 0.0, 1.0);
    float steepness = 1.0 - flatness;
    float flatnessPow = flatness * flatness;

    // --- 1. SAND & RED SAND (Wind Ripples) ---
    if (channel == 5.0 || channel == 10.0) {
      // Simple ripples with cheap warp
      float warp = cheapNoise(worldPos * 0.08) * 1.5;
      float phase = dot(worldPos.xz, wind) * 3.2 + warp;
      float ripple = sin(phase) * 0.7 + sin(phase * 2.0 + 0.5) * 0.3;

      // Cross-ripples (pure sine, no noise)
      vec2 crossWind = vec2(-wind.y, wind.x);
      float crossRipple = sin(dot(worldPos.xz, crossWind) * 5.0) * 0.15;

      vec3 g = vec3(wind.x, 0.0, wind.y);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * ((ripple + crossRipple) * base * flatnessPow * 0.35));
    }

    // --- 2. ROCK, BEDROCK, OBSIDIAN (Stratified Layers) ---
    else if (channel == 2.0 || channel == 1.0 || channel == 15.0 || channel == 9.0) {
      // Simple strata with cheap warp
      float strataWarp = cheapNoise(worldPos * 0.12) * 1.5;
      float strataPhase = worldPos.y * 2.8 + strataWarp;
      float strata = abs(mod(strataPhase, 2.0) - 1.0);
      strata = smoothstep(0.25, 0.75, strata);

      // Simple weathering (single noise sample)
      float weathering = cheapNoise(worldPos * 0.4) * 2.0 - 1.0;

      float strataContrib = (strata - 0.5) * steepness * 0.6;
      float weatherContrib = weathering * 0.2;

      vec3 strataDir = vec3(0.0, 1.0, 0.0);
      strataDir = strataDir - nn * dot(strataDir, nn);

      // Simplified weathering direction (derived from position, no extra noise)
      vec3 weatherDir = normalize(vec3(sin(worldPos.x * 0.3), 0.0, cos(worldPos.z * 0.3)));
      weatherDir = weatherDir - nn * dot(weatherDir, nn);

      nn = normalize(nn + strataDir * strataContrib * base + weatherDir * weatherContrib * base);
    }

    // --- 3. DIRT, CLAY, TERRACOTTA (Clumpy) ---
    else if (channel == 3.0 || channel == 7.0 || channel == 11.0) {
      // Single noise sample for clumps
      float clumps = cheapNoise(worldPos * 0.6) * 2.0 - 1.0;

      // Direction derived from position (no extra noise calls)
      vec3 g = normalize(vec3(
        sin(worldPos.x * 0.7 + 50.0),
        sin(worldPos.y * 0.7 + 25.0) * 0.5,
        cos(worldPos.z * 0.7 + 50.0)
      ));
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (clumps * base * 0.25));
    }

    // --- 4. GRASS & JUNGLE GRASS (Gentle swells) ---
    else if (channel == 4.0 || channel == 13.0) {
      // Single low-freq noise + sine wave
      float swell = cheapNoise(worldPos * 0.15) * 2.0 - 1.0;
      float bladeHint = sin(worldPos.x * 1.5 + worldPos.z * 0.8) * 0.3;
      float combined = swell * 0.7 + bladeHint * 0.3;

      vec3 g = vec3(1.0, 0.0, 0.5);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (combined * base * flatnessPow * 0.15));
    }

    // --- 5. SNOW (Soft Drifts) ---
    else if (channel == 6.0) {
      // Single low-freq noise for drift shape
      float drift = cheapNoise(worldPos * 0.08);
      float windDrift = sin(dot(worldPos.xz, wind) * 0.3 + drift * 4.0);

      vec3 g = vec3(wind.x * 0.5, 0.0, wind.y * 0.5 + 0.5);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * ((drift + windDrift) * 0.5 * base * 0.2));
    }

    // --- 6. ICE (Subtle variation) ---
    else if (channel == 12.0) {
      // Single noise sample
      float surface = cheapNoise(worldPos * 0.3) * 2.0 - 1.0;

      vec3 g = normalize(vec3(sin(worldPos.x * 0.8), 0.0, cos(worldPos.z * 0.8)));
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (surface * base * 0.1));
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
    vLightColor = aLightColor;  // Pass GI light to fragment
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
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
    csm_Normal = applyDominantNormal(normal, vWorldPosition, vDominantChannel, vDominantWeight);
  }
`;

export const triplanarFragmentShader = `
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
  uniform vec3 uColorRedSand;
  uniform vec3 uColorTerracotta;
  uniform vec3 uColorIce;
  uniform vec3 uColorJungleGrass;
  uniform vec3 uColorGlowStone;
  uniform vec3 uColorObsidian;

  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uFogDensity; // For Exp2
  uniform float uHeightFogEnabled;
  uniform float uHeightFogStrength;
  uniform float uHeightFogRange;
  uniform float uHeightFogOffset;
  uniform float uOpacity;
  uniform float uTriplanarDetail;
  uniform float uShaderFogEnabled;
  uniform float uShaderFogStrength;
  uniform float uWetnessEnabled;
  uniform float uMossEnabled;
  uniform float uRoughnessMin;
  uniform int uWeightsView;
  uniform float uMacroStrength;
  uniform float uCavityStrength;
  uniform vec2 uWindDirXZ;
  uniform float uNormalStrength;
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform float uWaterLevel;

  // Voxel GI - received as per-vertex attribute (baked from light grid)
  uniform float uGIEnabled;       // Toggle for GI (0 = off, 1 = on)
  uniform float uGIIntensity;     // GI strength multiplier

  // Biome-aware fog uniforms
  uniform float uBiomeFogDensityMul;  // Density multiplier from biome
  uniform float uBiomeFogHeightMul;   // Height fog multiplier from biome
  uniform vec3 uBiomeFogTint;         // RGB tint offset from biome
  uniform float uBiomeFogAerial;      // Aerial perspective strength
  uniform float uBiomeFogEnabled;     // Toggle for biome fog effects

  // Fragment normal perturbation (Phase 1 AAA improvement)
  uniform float uFragmentNormalStrength; // 0.0 = off, 0.3-0.5 = subtle, 1.0 = strong
  uniform float uFragmentNormalScale;    // Base frequency (0.2-0.5 typical)

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
  varying vec3 vLightColor;  // GI light interpolated from vertices

  vec3 safeNormalize(vec3 v) {
      float len = length(v);
      if (len < 0.0001) return vec3(0.0, 1.0, 0.0);
      return v / len;
  }

  vec4 getTriplanarNoise(vec3 normal, float scale) {
      vec3 blend = abs(normal);
      blend = normalize(max(blend, 0.00001));
      blend = pow(blend, vec3(4.0));
      blend /= dot(blend, vec3(1.0));
      vec3 p = vWorldPosition * scale;
      vec4 xN = texture(uNoiseTexture, p.zyx);
      vec4 yN = texture(uNoiseTexture, p.xzy + vec3(100.0));
      vec4 zN = texture(uNoiseTexture, p.xyz + vec3(200.0));
      return xN * blend.x + yN * blend.y + zN * blend.z;
  }

  // === PHASE 1: Fragment-level normal perturbation from 3D noise ===
  // This creates micro-detail that the vertex shader can't provide.
  // Uses central differences on 3D noise for proper tangent-space normals.
  vec3 getNoiseNormal(vec3 worldPos, vec3 geometryNormal, float scale, float strength) {
      float eps = 0.15; // Sample offset - tuned for noise texture resolution
      vec3 p = worldPos * scale;

      // Sample noise at offset positions for gradient calculation
      float cx = texture(uNoiseTexture, p + vec3(eps, 0.0, 0.0)).r
               - texture(uNoiseTexture, p - vec3(eps, 0.0, 0.0)).r;
      float cy = texture(uNoiseTexture, p + vec3(0.0, eps, 0.0)).r
               - texture(uNoiseTexture, p - vec3(0.0, eps, 0.0)).r;
      float cz = texture(uNoiseTexture, p + vec3(0.0, 0.0, eps)).r
               - texture(uNoiseTexture, p - vec3(0.0, 0.0, eps)).r;

      // Gradient vector (points "uphill" in noise field)
      vec3 grad = vec3(cx, cy, cz);

      // Project gradient onto tangent plane (perpendicular to geometry normal)
      vec3 tangentGrad = grad - geometryNormal * dot(grad, geometryNormal);

      // Perturb the normal
      return normalize(geometryNormal - tangentGrad * strength);
  }

  // Multi-octave noise normal for richer detail
  // Combines large bumps with fine detail - key for AAA look
  vec3 getMultiOctaveNoiseNormal(vec3 worldPos, vec3 geometryNormal, float baseScale, float strength, int octaves) {
      vec3 perturbedNormal = geometryNormal;
      float scale = baseScale;
      float amp = strength;

      for (int i = 0; i < 3; i++) { // Max 3 octaves for performance
          if (i >= octaves) break;
          perturbedNormal = getNoiseNormal(worldPos, perturbedNormal, scale, amp);
          scale *= 2.1; // Lacunarity
          amp *= 0.45;  // Persistence - each octave contributes less
      }

      return perturbedNormal;
  }

  vec2 safeNormalize2(vec2 v) {
      float len = length(v);
      if (len < 0.0001) return vec2(1.0, 0.0);
      return v / len;
  }

  // Get GI light from per-vertex attribute (baked from light grid in mesher)
  vec3 getGILight() {
      if (uGIEnabled < 0.5) {
          // Fallback to simple ambient when GI is disabled
          return vec3(0.35);
      }
      // vLightColor comes from the vertex attribute, already interpolated
      return vLightColor * uGIIntensity;
  }

  float sampleCausticPattern(vec2 uv, float ang, float tz1, float tz2) {
      vec2 flow1 = vec2(cos(ang), sin(ang)) * 0.5;
      vec3 p1a = vec3(uv * 0.7 + flow1, tz1);
      vec3 p1b = vec3(uv * 0.7 - flow1, tz2);
      float n1a = texture(uNoiseTexture, p1a).r;
      float n1b = texture(uNoiseTexture, p1b).r;
      float r1 = pow(1.0 - abs(min(n1a, n1b) - 0.5) * 2.0, 10.0);
      return r1;
  }

  vec3 getRealisticCaustics(vec3 pos, vec3 sunDir, float t) {
      const float TWO_PI = 6.28318530718;
      const float CAUSTICS_LOOP_SECONDS = 20.0;
      float lt = mod(t * 0.5, CAUSTICS_LOOP_SECONDS);
      float ang = (lt / CAUSTICS_LOOP_SECONDS) * TWO_PI;
      vec3 lightDir = normalize(vec3(sunDir.x, sunDir.y + 0.5, sunDir.z));
      float distToSurface = uWaterLevel - pos.y;
      vec2 uv = (pos.xz - lightDir.xz * (distToSurface / max(0.2, lightDir.y))) * 0.45;
      float tz1 = 0.5 + 0.5 * sin(ang);
      float tz2 = 0.5 + 0.5 * cos(ang);
      float disp = 0.006; // AAA FIX: Reduced from 0.012 to avoid rainbow noise
      float r = sampleCausticPattern(uv * (1.0 + disp), ang, tz1, tz2);
      float g = sampleCausticPattern(uv, ang, tz1, tz2);
      float b = sampleCausticPattern(uv * (1.0 - disp), ang, tz1, tz2);
      vec3 finalC = vec3(r, g, b);
      float overlap = min(r, min(g, b));
      finalC += overlap * 0.8; // AAA FIX: Slightly reduced overlap boost
      finalC *= 4.5; // AAA FIX: Reduced from 6.0 to prevent blowout
      float depthFade = exp(-distToSurface * 0.18); 
      return finalC * depthFade;
  }

  struct MatInfo {
      vec3 baseCol;
      float roughness;
      float noiseFactor;
      float emission;
  };

  MatInfo getMatParams(int channel, vec4 nMid, vec4 nHigh) {
      vec3 baseCol = uColorStone;
      float roughness = 0.8;
      float noiseFactor = 0.0;
      float emission = 0.0;
      if (channel == 1) { baseCol = uColorBedrock; noiseFactor = nMid.r * 0.7 + nHigh.r * 0.3; }
      else if (channel == 2) { baseCol = uColorStone; float cracks = nHigh.g; noiseFactor = mix(nMid.r, cracks, 0.4); }
      else if (channel == 3) { baseCol = uColorDirt; noiseFactor = nMid.g; }
      else if (channel == 4) { baseCol = uColorGrass; float bladeNoise = nHigh.a; float patchNoise = nMid.r; noiseFactor = mix(bladeNoise, patchNoise, 0.3); baseCol *= vec3(1.0, 1.1, 1.0); }
      else if (channel == 5) { baseCol = uColorSand; noiseFactor = nMid.g * 0.6 + nHigh.b * 0.4; } // AAA FIX: Use lower freq channels for sand texture
      else if (channel == 6) { baseCol = uColorSnow; noiseFactor = nMid.r * 0.5 + 0.5; }
      else if (channel == 7) { baseCol = uColorClay; noiseFactor = nMid.g; }
      else if (channel == 8) { baseCol = uColorWater; roughness = 0.1; }
      else if (channel == 9) { baseCol = uColorStone; noiseFactor = nMid.r; }
      else if (channel == 10) { baseCol = uColorRedSand; noiseFactor = nHigh.a; }
      else if (channel == 11) { baseCol = uColorTerracotta; noiseFactor = nMid.g; roughness = 0.95; }
      else if (channel == 12) { baseCol = uColorIce; noiseFactor = nMid.b * 0.5; roughness = 0.05; }
      else if (channel == 13) { baseCol = uColorJungleGrass; noiseFactor = nHigh.a; }
      else if (channel == 14) { baseCol = uColorGlowStone; noiseFactor = nMid.r + 0.5; emission = 2.0; }
      else if (channel == 15) { baseCol = uColorObsidian; noiseFactor = nHigh.b * 0.3; roughness = 0.15; }
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
    float distSq = dot(vWorldPosition - cameraPosition, vWorldPosition - cameraPosition);
    bool lowDetail = distSq > 1024.0; // Beyond 32 units (1 chunk)

    // === PHASE 1: Fragment-level normal perturbation (OPTIMIZED) ===
    // Single octave only, tighter distance cutoff for performance.
    // Only apply very close to camera (within 12 units / 144 distSq)
    if (uFragmentNormalStrength > 0.01 && distSq < 144.0) {
        float distFade = 1.0 - smoothstep(64.0, 144.0, distSq); // Fade 8-12 units
        float effectiveStrength = uFragmentNormalStrength * distFade;

        if (effectiveStrength > 0.02) {
            // Single octave only - much cheaper
            N = getNoiseNormal(vWorldPosition, N, uFragmentNormalScale, effectiveStrength);
        }
    }

    vec4 nMid = getTriplanarNoise(N, 0.15);
    float highScale = mix(0.15, 0.6, clamp(uTriplanarDetail, 0.0, 1.0));
    vec4 nHigh = lowDetail ? nMid : getTriplanarNoise(N, highScale);
    vec4 nMacro = texture(uNoiseTexture, vWorldPosition * 0.012 + vec3(0.11, 0.07, 0.03));
    float macro = (nMacro.r * 2.0 - 1.0) * clamp(uMacroStrength, 0.0, 2.0);
    vec3 accColor = vec3(0.0);
    float accRoughness = 0.0;
    float accNoise = 0.0;
    float accEmission = 0.0;
    float totalW = 0.0;
    float dominantWeight = -1.0;
    int dominantChannel = 2;
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
      accColor /= totalW; accRoughness /= totalW; accNoise /= totalW; accEmission /= totalW;
    } else {
      accColor = uColorStone; accRoughness = 0.9; accNoise = 0.0;
    }
    float intensity = 0.6 + 0.6 * accNoise;
    vec3 col = accColor * intensity;
    if (uWeightsView != 0) {
      float grassW = vWb.x; float snowW = vWb.z;
      if (uWeightsView == 1) col = vec3(snowW);
      else if (uWeightsView == 2) col = vec3(grassW);
      else if (uWeightsView == 3) col = vec3(clamp((snowW - grassW) * 2.0 + 0.5, 0.0, 1.0));
      else if (uWeightsView == 4) {
        float stoneW = vWa.z; float dirtW = vWa.w; float maxW = stoneW; vec3 c = vec3(0.5);
        if (dirtW > maxW) { maxW = dirtW; c = vec3(0.35, 0.25, 0.15); }
        if (grassW > maxW) { maxW = grassW; c = vec3(0.1, 0.6, 0.1); }
        if (snowW > maxW) { maxW = snowW; c = vec3(0.9); }
        col = c;
      }
      csm_DiffuseColor = vec4(col, uOpacity); csm_Emissive = vec3(0.0); csm_Roughness = 1.0; csm_Metalness = 0.0; return;
    }
    float mossMatWeight = vWc.y; float effectiveMoss = max(vMossiness, mossMatWeight);
    if (uMossEnabled > 0.5 && effectiveMoss > 0.001) {
      vec3 mossColor = uColorMoss;
      float organicNoise = mix(nMid.r, nHigh.g, 0.4); 
      float threshold = 1.0 - effectiveMoss;
      float mossMix = smoothstep(threshold - 0.4, threshold + 0.4, organicNoise);
      col = mix(col, mossColor * (0.6 + 0.4 * nHigh.a), mossMix);
      accRoughness = mix(accRoughness, 0.9, mossMix);
    }
    if (uWetnessEnabled > 0.5) col = mix(col, col * 0.5, vWetness * 0.9);
    col *= (1.0 + macro * 0.06); accRoughness += macro * 0.05;
    // === PHASE 3: Material-specific contextual rules ===
    // Slope and height-aware color/texture variation for AAA quality
    int dom = int(floor(vDominantChannel + 0.5));
    vec2 wind = safeNormalize2(uWindDirXZ);
    float slope = 1.0 - N.y; // 0 = flat, 1 = vertical
    float slopePow = pow(slope, 1.5); // Emphasize steep areas
    float heightNorm = clamp(vWorldPosition.y / 80.0, 0.0, 1.0); // Normalize height (0-80)

    // --- SAND & RED_SAND: Slope-aware ripples + grain variation ---
    if (dom == 5 || dom == 10) {
      // Ripples fade on slopes (sand slides down)
      float rippleStrength = 1.0 - smoothstep(0.2, 0.6, slope);
      float rip = sin(dot(vWorldPosition.xz, wind) * 2.8 + (nMacro.g * 2.0 - 1.0) * 0.6);
      // Grain color variation - not just brightness, add warmth in troughs
      vec3 warmShift = vec3(1.02, 0.98, 0.94); // Slightly warmer
      vec3 coolShift = vec3(0.98, 1.0, 1.02);  // Slightly cooler
      col *= mix(warmShift, coolShift, rip * 0.5 + 0.5);
      col *= 1.0 + rip * 0.04 * rippleStrength;
      // Mottling - dark mineral grains
      float mott = (nMid.g * 2.0 - 1.0);
      col *= 1.0 + mott * 0.025;
      accRoughness = mix(accRoughness, 0.92, 0.35);
    }

    // --- ROCK, BEDROCK, OBSIDIAN: Weathered surfaces + lichen hints ---
    else if (dom == 2 || dom == 1 || dom == 15 || dom == 9) {
      // Strata bands - stronger on cliffs
      float bands = sin(vWorldPosition.y * 1.4 + (nMacro.b * 2.0 - 1.0) * 1.2);
      float bandStrength = slopePow * 0.04; // Only visible on steep faces

      // Weathering - exposed faces lighter, overhangs darker
      float exposure = smoothstep(-0.3, 0.3, N.y); // 0 = overhang, 1 = exposed
      vec3 weatherShift = mix(vec3(0.85, 0.87, 0.9), vec3(1.05, 1.03, 1.0), exposure);
      col *= weatherShift;

      // Cracks - darker lines
      float cracks = pow(1.0 - abs(nHigh.g * 2.0 - 1.0), 3.5);
      col *= 1.0 - cracks * 0.1;
      col *= 1.0 + bands * bandStrength;

      // Height-based weathering: higher = more oxidized (slightly warmer)
      vec3 oxidation = mix(vec3(1.0), vec3(1.02, 0.99, 0.97), heightNorm * 0.5);
      col *= oxidation;

      accRoughness += cracks * 0.08 + slopePow * 0.05;
    }

    // --- DIRT, CLAY, TERRACOTTA: Organic clumping + moisture hints ---
    else if (dom == 3 || dom == 7 || dom == 11) {
      float clump = (nHigh.r * 2.0 - 1.0);
      // Darker in clump shadows
      col *= 1.0 + clump * 0.035;
      col *= 1.0 - smoothstep(0.2, 0.9, abs(clump)) * 0.07;

      // Moisture hints in sheltered areas (slight color shift)
      float shelter = 1.0 - N.y; // Overhangs more sheltered
      vec3 moistShift = mix(vec3(1.0), vec3(0.95, 0.93, 0.9), shelter * 0.3);
      col *= moistShift;

      // Terracotta (11) gets iron oxide variation
      if (dom == 11) {
        float oxide = nMacro.r * 0.15;
        col *= vec3(1.0 + oxide, 1.0 - oxide * 0.5, 1.0 - oxide);
      }

      accRoughness = mix(accRoughness, 0.95, 0.15);
    }

    // --- SNOW: Blue shadows + wind-packed variation ---
    else if (dom == 6) {
      // Blue tint in shadows (sky reflection)
      float shadowFactor = 1.0 - clamp(dot(N, uSunDirection), 0.0, 1.0);
      vec3 shadowTint = mix(vec3(1.0), vec3(0.9, 0.95, 1.08), shadowFactor * 0.4);
      col *= shadowTint;

      // Wind-packed areas slightly grayer
      float packed = nMacro.g;
      col = mix(col, col * vec3(0.95, 0.96, 0.97), packed * 0.25);

      // Sparkle highlights on sun-facing surfaces
      float sparkle = pow(max(0.0, dot(N, uSunDirection)), 8.0) * nHigh.r;
      col += vec3(sparkle * 0.15);

      accRoughness = mix(accRoughness, 0.98, 0.45);
    }

    // --- ICE: Depth color + fresnel hints ---
    else if (dom == 12) {
      // Deeper blue where thicker (approximated by cavity/overhang)
      float depth = vCavity * 0.5 + (1.0 - N.y) * 0.3;
      vec3 depthTint = mix(vec3(1.0), vec3(0.85, 0.92, 1.1), depth);
      col *= depthTint;

      // Subtle green-blue shift variation
      float variation = nMid.b * 0.1;
      col *= vec3(1.0 - variation * 0.5, 1.0, 1.0 + variation);

      accRoughness = mix(accRoughness, 0.12, 0.35);
    }

    // --- GLOWSTONE: Pulsing variation ---
    else if (dom == 14) {
      float pulse = nMacro.a * 2.0 - 1.0;
      col *= 1.0 + pulse * 0.04;
    }

    // --- GRASS & JUNGLE GRASS: Healthy/stressed variation ---
    else if (dom == 4 || dom == 13) {
      // Macro color variation - patches of different health
      float health = nMacro.g;
      // Healthy = greener, stressed = more yellow-brown
      vec3 healthyShift = vec3(0.95, 1.05, 0.92);
      vec3 stressedShift = vec3(1.05, 1.0, 0.88);
      col *= mix(stressedShift, healthyShift, health);

      // Slight darkening on slopes (self-shadowing)
      col *= 1.0 - slopePow * 0.08;

      // Jungle grass (13) is darker and more saturated
      if (dom == 13) {
        col *= vec3(0.92, 0.98, 0.88);
      }
    }
    float cav = clamp(vCavity, 0.0, 1.0) * clamp(uCavityStrength, 0.0, 2.0);
    col *= mix(1.0, 0.65, cav); accRoughness = mix(accRoughness, 1.0, cav * 0.25);

    // Apply voxel-based global illumination
    vec3 giLight = getGILight();
    col *= giLight;

    col = clamp(col, 0.0, 5.0); col += accEmission * accColor; 
    if (!lowDetail && vWetness > 0.05 && vWorldPosition.y < uWaterLevel && uSunDirection.y > 0.0) {
        float waterDepth = uWaterLevel - vWorldPosition.y;
        float depthMask = smoothstep(16.0, 0.0, waterDepth); // AAA FIX: Tighter depth mask (16m)
        float normalMask = clamp(dot(N, uSunDirection), 0.0, 1.0);
        float openMask = 1.0 - smoothstep(0.0, 0.3, vCavity);
        float floorMask = smoothstep(0.25, 0.65, N.y);
        if (depthMask > 0.01 && normalMask > 0.01 && openMask > 0.01 && floorMask > 0.01) {
             vec3 caus = getRealisticCaustics(vWorldPosition, uSunDirection, uTime);
             float variation = texture(uNoiseTexture, vec3(vWorldPosition.xz * 0.008, 0.0)).b;
             float variationMask = smoothstep(0.35, 0.65, variation);
             vec3 finalCaustic = caus * depthMask * normalMask * openMask * floorMask * variationMask;
             col += finalCaustic * 0.3; 
        }
    } 
    if (uShaderFogEnabled > 0.5) {
      float fogDist = length(vWorldPosition - cameraPosition);

      // === BIOME-AWARE FOG SYSTEM ===

      // 1. Base density from biome (deserts thin, jungles thick)
      float biomeDensity = uBiomeFogEnabled > 0.5 ? uBiomeFogDensityMul : 1.0;

      // 2. Exponential Squared Fog with biome modulation
      float fogRange = max(uFogFar - uFogNear, 1.0);
      float density = (4.0 / fogRange) * biomeDensity;
      float distFactor = max(0.0, fogDist - uFogNear);
      float baseFog = 1.0 - exp(-pow(distFactor * density, 2.0));

      float fogAmt = baseFog;

      // 3. Height Fog with biome modulation and valley pooling
      if (uHeightFogEnabled > 0.5) {
          float biomeHeightMul = uBiomeFogEnabled > 0.5 ? uBiomeFogHeightMul : 1.0;

          // Base height factor: 1.0 at floor, 0.0 at ceiling
          float heightFactor = smoothstep(uHeightFogOffset + uHeightFogRange, uHeightFogOffset, vWorldPosition.y);

          // Valley pooling: use world-space noise to create natural fog accumulation
          // Low-frequency noise simulates fog pooling in terrain depressions
          vec4 valleyNoise = texture(uNoiseTexture, vec3(vWorldPosition.xz * 0.008, 0.1));
          float valleyPool = valleyNoise.r * 0.4 + 0.6; // 0.6 to 1.0 range

          // Boost factor in valleys (lower areas get more fog)
          float valleyBoost = mix(1.0, valleyPool * 1.3, heightFactor);

          // Distance factor: Don't fog the player's feet.
          // Fade in height fog from 5m to 25m.
          float hDistFactor = smoothstep(5.0, 25.0, fogDist);

          float heightFog = heightFactor * uHeightFogStrength * biomeHeightMul * valleyBoost * hDistFactor;
          fogAmt = clamp(fogAmt + heightFog, 0.0, 1.0);
      }

      // 4. Aerial Perspective (desaturation with distance, independent of fog opacity)
      // This simulates how air scatters light, making distant objects appear washed out
      if (uBiomeFogEnabled > 0.5 && uBiomeFogAerial > 0.01) {
          float aerialDist = smoothstep(uFogNear * 0.5, uFogFar * 0.8, fogDist);
          float aerialStrength = aerialDist * uBiomeFogAerial;

          // Desaturate: blend toward luminance
          float luma = dot(col, vec3(0.299, 0.587, 0.114));
          vec3 desaturated = vec3(luma);
          col = mix(col, desaturated, aerialStrength * 0.6);

          // Shift toward sky color slightly
          col = mix(col, uFogColor, aerialStrength * 0.15);
      }

      // 5. Biome color tinting
      vec3 tintedFogColor = uFogColor;
      if (uBiomeFogEnabled > 0.5) {
          tintedFogColor = clamp(uFogColor + uBiomeFogTint, 0.0, 1.0);
      }

      col = mix(col, tintedFogColor, fogAmt * uShaderFogStrength);
    }
    csm_DiffuseColor = vec4(col, clamp(uOpacity, 0.0, 1.0));
    csm_Emissive = vec3(accEmission * accColor);
    accRoughness -= (nHigh.r * 0.1);
    if (uWetnessEnabled > 0.5) accRoughness = mix(accRoughness, 0.2, vWetness);
    accRoughness = max(accRoughness, clamp(uRoughnessMin, 0.0, 1.0));
    if (dominantChannel == 8) accRoughness = 0.1;
    csm_Roughness = accRoughness;
    csm_Metalness = 0.0;
  }
`;
