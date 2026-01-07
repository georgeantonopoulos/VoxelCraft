export const triplanarVertexShader = `
  attribute vec4 aMatWeightsA;
  attribute vec4 aMatWeightsB;
  attribute vec4 aMatWeightsC;
  attribute vec4 aMatWeightsD;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;
  attribute float aVoxelCavity;
  attribute vec3 aLightColor;  // Per-vertex GI light from light grid
  attribute float aBaseHumidity;  // Per-vertex base humidity from biome + water proximity
  attribute float aTreeHumidityBoost;  // Per-vertex humidity boost from Sacred Grove trees

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
  varying float vBaseHumidity;  // Pass base humidity to fragment shader
  varying float vTreeHumidityBoost;  // Pass tree boost to fragment shader

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
    vBaseHumidity = aBaseHumidity;  // Pass base humidity to fragment
    vTreeHumidityBoost = aTreeHumidityBoost;  // Pass tree boost to fragment
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

  // Color grading (in-shader, not post-processing)
  uniform float uTerrainSaturation;      // 1.0=neutral, >1=more saturated

  // Humidity Spreading System - DISABLED (causes GPU perf issues with array uniforms)
  // TODO: Re-implement using vertex attributes or texture-based approach instead
  // uniform int uGrownTreeCount;
  // uniform vec2 uGrownTreePositions[8];
  // uniform float uGrownTreeAges[8];
  // uniform float uHumiditySpreadRate;
  // uniform float uHumidityMaxRadius;

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
  varying float vBaseHumidity;  // Base humidity from biome + water proximity
  varying float vTreeHumidityBoost;  // Humidity boost from Sacred Grove trees

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

  // === PHASE 1: Cheap micro-detail from triplanar noise ===
  // Instead of expensive extra texture samples, we derive detail from
  // the noise we already sample for material colors.
  // This function takes the already-sampled triplanar noise and creates
  // a perturbed normal from it - essentially FREE since we have the data.
  vec3 getMicroDetailNormal(vec3 geometryNormal, vec4 noiseData, vec4 noiseDataHigh, vec3 worldPos, float strength, float flatness) {
      // Use different noise channels for X and Z perturbation
      // This creates apparent surface detail without extra texture reads
      float nx = noiseData.r * 2.0 - 1.0;  // Red channel -> X perturbation
      float nz = noiseData.g * 2.0 - 1.0;  // Green channel -> Z perturbation

      // High-frequency detail from nHigh - critical for close-up ground detail
      float hx = noiseDataHigh.b * 2.0 - 1.0;
      float hz = noiseDataHigh.a * 2.0 - 1.0;

      // Add ultra-high-frequency variation using position-based hash (very cheap)
      // This breaks up repetition and adds "grain" to flat surfaces
      vec3 hp = fract(worldPos * 4.5) * 2.0 - 1.0;  // Higher frequency than before
      vec3 hp2 = fract(worldPos * 11.0) * 2.0 - 1.0; // Even finer grain

      // Flat surfaces (grass, dirt) need MORE fine detail
      // Steep surfaces (cliffs) look fine with coarser detail
      float fineDetailBoost = flatness * flatness; // 1.0 for flat, 0.0 for vertical

      // Layer the frequencies:
      // - Low freq (nx, nz): broad undulation
      // - Mid freq (hx, hz): medium bumps
      // - High freq (hp): fine texture
      // - Ultra-high freq (hp2): micro-grain for flat surfaces
      float perturbX = nx * 0.3
                     + hx * 0.35
                     + hp.x * noiseData.b * 0.25
                     + hp2.x * noiseDataHigh.r * 0.1 * fineDetailBoost;

      float perturbZ = nz * 0.3
                     + hz * 0.35
                     + hp.z * noiseData.a * 0.25
                     + hp2.z * noiseDataHigh.g * 0.1 * fineDetailBoost;

      // Create tangent-space perturbation vector
      vec3 tangent = normalize(vec3(1.0, 0.0, 0.0) - geometryNormal * geometryNormal.x);
      vec3 bitangent = normalize(cross(geometryNormal, tangent));

      vec3 perturbation = tangent * perturbX + bitangent * perturbZ;

      // Boost strength slightly for flat surfaces (they need more visible detail)
      float flatBoost = 1.0 + fineDetailBoost * 0.4;

      return normalize(geometryNormal + perturbation * strength * flatBoost);
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

  // Apply saturation adjustment (in-shader color grading)
  // sat=1.0 is neutral, >1 increases saturation, <1 decreases
  vec3 adjustSaturation(vec3 color, float sat) {
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      return mix(vec3(luma), color, sat);
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

  // HUMIDITY SPREADING FUNCTION - DISABLED (causes GPU perf issues)
  // TODO: Re-implement using vertex attributes or texture-based approach
  /*
  float getHumidityInfluence(vec2 worldPosXZ) {
    // ... disabled ...
    return 0.0;
  }
  */

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
    bool closeUp = distSq < 400.0;    // Within 20 units - fine detail zone

    // Sample triplanar noise FIRST (we need this for colors anyway)
    vec4 nMid = getTriplanarNoise(N, 0.15);
    float highScale = mix(0.15, 0.6, clamp(uTriplanarDetail, 0.0, 1.0));
    vec4 nHigh = lowDetail ? nMid : getTriplanarNoise(N, highScale);

    // === FINE DETAIL: Sample at very high scale for close-up ground texture ===
    // This is the key to AAA terrain - fine grain visible when looking at your feet
    // Scale of 2.5 gives ~0.4 world unit detail cycles, 5.0 gives ~0.2 world unit
    vec4 nFine = closeUp ? getTriplanarNoise(N, 2.5) : nHigh;
    vec4 nUltraFine = (closeUp && distSq < 100.0) ? getTriplanarNoise(N, 6.0) : nFine;

    // === PHASE 1: Multi-frequency normal perturbation ===
    if (uFragmentNormalStrength > 0.01 && distSq < 4096.0) {
        float distFade = 1.0 - smoothstep(256.0, 4096.0, distSq);
        float effectiveStrength = uFragmentNormalStrength * distFade;

        if (effectiveStrength > 0.01) {
            float flatness = clamp(N.y, 0.0, 1.0);

            // Use fine detail samples for close-up perturbation
            vec4 detailNoise = closeUp ? nFine : nHigh;
            vec4 microNoise = (closeUp && distSq < 100.0) ? nUltraFine : detailNoise;

            N = getMicroDetailNormal(N, detailNoise, microNoise, vWorldPosition, effectiveStrength * uFragmentNormalScale, flatness);
        }
    }
    vec4 nMacro = texture(uNoiseTexture, vWorldPosition * 0.012 + vec3(0.11, 0.07, 0.03));
    float macro = (nMacro.r * 2.0 - 1.0) * clamp(uMacroStrength, 0.0, 2.0);

    // === HUMIDITY FIELD SYSTEM ===
    // Two-layer humidity: base (biome+water) + tree boost (Sacred Grove)
    // Both values are baked into vertex attributes during meshing - zero per-fragment cost!
    float totalHumidity = clamp(vBaseHumidity + vTreeHumidityBoost, 0.0, 1.0);

    // Material weight deltas based on humidity
    // High humidity: boost grass/dirt, reduce desert materials
    float humidityDeltaGrass = totalHumidity * 0.6;
    float humidityDeltaDirt = totalHumidity * 0.3;
    float humidityDeltaRedSand = -totalHumidity * 0.8;
    float humidityDeltaStone = -totalHumidity * 0.2;
    float humidityDeltaTerracotta = -totalHumidity * 0.5;

    vec3 accColor = vec3(0.0);
    float accRoughness = 0.0;
    float accNoise = 0.0;
    float accEmission = 0.0;
    float totalW = 0.0;
    float dominantWeight = -1.0;
    int dominantChannel = 2;
    accumulateChannel(0, vWa.x, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(1, vWa.y, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(2, vWa.z + humidityDeltaStone, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(3, vWa.w + humidityDeltaDirt, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(4, vWb.x + humidityDeltaGrass, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(5, vWb.y, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(6, vWb.z, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(7, vWb.w, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(8, vWc.x, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(9, vWc.y, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(10, vWc.z + humidityDeltaRedSand, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
    accumulateChannel(11, vWc.w + humidityDeltaTerracotta, nMid, nHigh, accColor, accRoughness, accNoise, accEmission, totalW, dominantChannel, dominantWeight);
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
    // === HUMIDITY-BASED VISUAL WETNESS ===
    // Materials respond differently to humidity:
    // - Sand, stone, dirt, clay: get visually wet (darker, shinier)
    // - Grass: stays dry (water drains, leaves shed water)
    // - Snow, ice: unaffected (already frozen water)
    // Weight how much this surface should show wetness based on material composition
    float wettableMaterials = vWa.z + vWa.w + vWb.y + vWb.w + vWc.z + vWc.w; // stone + dirt + sand + clay + red_sand + terracotta
    float nonWettableMaterials = vWb.x + vWb.z + vWd.y; // grass + snow + ice
    float wettabilityFactor = clamp(wettableMaterials / max(wettableMaterials + nonWettableMaterials, 0.001), 0.0, 1.0);

    // Humidity contributes to visual wetness for wettable materials
    float humidityWetness = totalHumidity * wettabilityFactor * 0.7; // 0.7 = max humidity wetness contribution
    float combinedWetness = max(vWetness, humidityWetness);

    if (uWetnessEnabled > 0.5) col = mix(col, col * 0.5, combinedWetness * 0.9);
    col *= (1.0 + macro * 0.06); accRoughness += macro * 0.05;

    // === UNIVERSAL FINE GRAIN: Apply to ALL terrain close-up ===
    // This gives every surface visible micro-texture when viewed up close
    if (closeUp) {
        // Fine-scale brightness variation (soil grain, surface roughness)
        float fineGrain = nFine.r * 2.0 - 1.0;
        float microGrain = nUltraFine.g * 2.0 - 1.0;

        // Distance-based intensity: strongest at feet, fades by 20 units
        float grainFade = 1.0 - smoothstep(25.0, 400.0, distSq);

        // Universal micro-variation in brightness
        float brightnessVar = 1.0 + fineGrain * 0.08 * grainFade;

        // Ultra-fine grain for very close (within 10 units)
        if (distSq < 100.0) {
            brightnessVar += microGrain * 0.05;
        }

        col *= brightnessVar;

        // Subtle color temperature shifts at micro scale
        // Slightly warmer in "peaks", cooler in "valleys"
        float tempShift = nFine.b * 2.0 - 1.0;
        vec3 warmCool = vec3(1.0 + tempShift * 0.02 * grainFade,
                             1.0,
                             1.0 - tempShift * 0.02 * grainFade);
        col *= warmCool;

        // Micro-shadow in crevices (based on ultra-fine noise)
        float crevice = smoothstep(0.6, 0.9, nUltraFine.r);
        col *= mix(1.0, 0.92, crevice * grainFade * 0.7);
    }

    // === PHASE 3: Material-specific fine detail for AAA quality ===
    // Each material gets unique micro-texture visible at close range
    int dom = int(floor(vDominantChannel + 0.5));
    vec2 wind = safeNormalize2(uWindDirXZ);
    float slope = 1.0 - N.y; // 0 = flat, 1 = vertical
    float slopePow = pow(slope, 1.5);
    float heightNorm = clamp(vWorldPosition.y / 80.0, 0.0, 1.0);
    float grainFade = closeUp ? (1.0 - smoothstep(25.0, 400.0, distSq)) : 0.0;

    // --- SAND & RED_SAND (5, 10): Individual grains + ripples ---
    if (dom == 5 || dom == 10) {
      // Macro ripples
      float rippleStrength = 1.0 - smoothstep(0.2, 0.6, slope);
      float rip = sin(dot(vWorldPosition.xz, wind) * 2.8 + (nMacro.g * 2.0 - 1.0) * 0.6);
      col *= 1.0 + rip * 0.04 * rippleStrength;

      // Fine detail: individual sand grains
      if (closeUp) {
        // Grain brightness variation - some grains lighter (quartz), some darker (minerals)
        float grainLight = smoothstep(0.6, 0.8, nFine.r);
        float grainDark = smoothstep(0.7, 0.9, nUltraFine.g);
        col *= 1.0 + grainLight * 0.12 * grainFade;
        col *= 1.0 - grainDark * 0.08 * grainFade;

        // Sparkly quartz grains
        float sparkle = pow(nUltraFine.b, 4.0) * grainFade;
        col += vec3(sparkle * 0.06);

        // Color variation - some grains warmer, some cooler
        float warmGrain = nFine.g * 2.0 - 1.0;
        col *= vec3(1.0 + warmGrain * 0.03, 1.0, 1.0 - warmGrain * 0.02);
      }
      accRoughness = mix(accRoughness, 0.92, 0.35);
    }

    // --- STONE (2): Mineral crystals + weathering ---
    else if (dom == 2) {
      float bands = sin(vWorldPosition.y * 1.4 + (nMacro.b * 2.0 - 1.0) * 1.2);
      col *= 1.0 + bands * slopePow * 0.04;

      if (closeUp) {
        // Mineral crystal faces - slight color shifts
        float crystal = smoothstep(0.5, 0.8, nFine.r);
        col *= 1.0 + crystal * 0.08 * grainFade;

        // Mica sparkle
        float mica = pow(nUltraFine.a, 5.0);
        col += vec3(mica * 0.04 * grainFade);

        // Micro-cracks (darker lines)
        float microCrack = smoothstep(0.75, 0.85, nUltraFine.g);
        col *= 1.0 - microCrack * 0.15 * grainFade;

        // Iron staining variation
        float iron = nFine.b * 0.06 * grainFade;
        col *= vec3(1.0 + iron, 1.0 - iron * 0.3, 1.0 - iron * 0.5);
      }
      accRoughness += slopePow * 0.05;
    }

    // --- BEDROCK (1): Dense, ancient rock texture ---
    else if (dom == 1) {
      float exposure = smoothstep(-0.3, 0.3, N.y);
      col *= mix(vec3(0.9), vec3(1.05), exposure);

      if (closeUp) {
        // Very fine crystalline structure
        float crystalline = nUltraFine.r * 2.0 - 1.0;
        col *= 1.0 + crystalline * 0.06 * grainFade;

        // Pressure bands
        float pressure = sin(vWorldPosition.y * 8.0 + nFine.g * 3.0);
        col *= 1.0 + pressure * 0.03 * grainFade;
      }
      accRoughness = mix(accRoughness, 0.85, 0.3);
    }

    // --- DIRT (3): Soil aggregates + organic matter ---
    else if (dom == 3) {
      float clump = (nHigh.r * 2.0 - 1.0);
      col *= 1.0 + clump * 0.04;

      if (closeUp) {
        // Visible soil aggregates (clumps)
        float aggregate = smoothstep(0.4, 0.7, nFine.r);
        col *= mix(0.92, 1.08, aggregate * grainFade);

        // Small pebbles/stones
        float pebbles = smoothstep(0.75, 0.88, nUltraFine.b);
        col = mix(col, col * 1.2, pebbles * 0.4 * grainFade);

        // Organic matter (darker specks)
        float organic = smoothstep(0.8, 0.95, nUltraFine.r);
        col *= 1.0 - organic * 0.2 * grainFade;

        // Root fragments (slightly lighter)
        float roots = smoothstep(0.85, 0.95, nFine.b) * smoothstep(0.5, 0.7, nUltraFine.g);
        col = mix(col, col * vec3(1.1, 1.05, 0.95), roots * 0.3 * grainFade);
      }
      accRoughness = mix(accRoughness, 0.95, 0.15);
    }

    // --- GRASS (4): Blade shadows + clover patches ---
    else if (dom == 4) {
      float health = nMacro.g;
      col *= mix(vec3(1.05, 1.0, 0.88), vec3(0.95, 1.05, 0.92), health);

      if (closeUp) {
        // Blade shadow pattern
        float bladeShadow = smoothstep(0.3, 0.7, nFine.b);
        col *= mix(0.88, 1.08, bladeShadow * grainFade);

        // Yellow grass tips
        float tips = smoothstep(0.7, 0.9, nUltraFine.r);
        col = mix(col, col * vec3(1.1, 1.05, 0.85), tips * 0.25 * grainFade);

        // Clover/weed patches (slightly different green)
        float clover = smoothstep(0.8, 0.95, nFine.g);
        col = mix(col, col * vec3(0.9, 1.1, 0.95), clover * 0.2 * grainFade);

        // Dead grass patches
        float dead = smoothstep(0.85, 0.98, nUltraFine.a);
        col = mix(col, col * vec3(1.15, 1.1, 0.8), dead * 0.3 * grainFade);
      }
      col *= 1.0 - slopePow * 0.08;
    }

    // --- SNOW (6): Crystal sparkle + blue shadows ---
    else if (dom == 6) {
      float shadowFactor = 1.0 - clamp(dot(N, uSunDirection), 0.0, 1.0);
      col *= mix(vec3(1.0), vec3(0.9, 0.95, 1.08), shadowFactor * 0.4);

      if (closeUp) {
        // Individual ice crystal sparkle
        float crystalSparkle = pow(nUltraFine.r, 6.0);
        col += vec3(crystalSparkle * 0.15 * grainFade);

        // Surface texture variation
        float snowGrain = nFine.g * 2.0 - 1.0;
        col *= 1.0 + snowGrain * 0.04 * grainFade;

        // Wind-packed vs fluffy variation
        float packed = smoothstep(0.6, 0.8, nFine.b);
        col *= mix(1.0, 0.96, packed * grainFade);

        // Blue ice crystals occasionally visible
        float blueIce = smoothstep(0.9, 0.98, nUltraFine.b);
        col = mix(col, col * vec3(0.9, 0.95, 1.15), blueIce * 0.3 * grainFade);
      }
      accRoughness = mix(accRoughness, 0.98, 0.45);
    }

    // --- CLAY (7): Smooth with fine cracks ---
    else if (dom == 7) {
      if (closeUp) {
        // Fine surface cracks
        float cracks = smoothstep(0.7, 0.85, nFine.r);
        col *= 1.0 - cracks * 0.12 * grainFade;

        // Slight color mottling
        float mottle = nUltraFine.g * 2.0 - 1.0;
        col *= 1.0 + mottle * 0.05 * grainFade;

        // Occasional lighter mineral inclusions
        float mineral = smoothstep(0.85, 0.95, nUltraFine.b);
        col = mix(col, col * 1.15, mineral * 0.25 * grainFade);
      }
      accRoughness = mix(accRoughness, 0.88, 0.2);
    }

    // --- RED SAND (10): Like sand but with iron oxide ---
    else if (dom == 10) {
      // Already handled with sand above, add iron-specific detail
      if (closeUp) {
        // Iron oxide variation - some grains more orange, some more brown
        float ironVar = nFine.r * 2.0 - 1.0;
        col *= vec3(1.0 + ironVar * 0.06, 1.0 - ironVar * 0.02, 1.0 - ironVar * 0.08);
      }
    }

    // --- TERRACOTTA (11): Fired clay texture ---
    else if (dom == 11) {
      float oxide = nMacro.r * 0.15;
      col *= vec3(1.0 + oxide, 1.0 - oxide * 0.5, 1.0 - oxide);

      if (closeUp) {
        // Firing variation - subtle color bands
        float firing = sin(vWorldPosition.y * 12.0 + nFine.g * 5.0);
        col *= 1.0 + firing * 0.03 * grainFade;

        // Micro-pores from firing
        float pores = smoothstep(0.75, 0.9, nUltraFine.r);
        col *= 1.0 - pores * 0.1 * grainFade;
      }
      accRoughness = mix(accRoughness, 0.92, 0.25);
    }

    // --- ICE (12): Subsurface scattering + bubbles ---
    else if (dom == 12) {
      float depth = vCavity * 0.5 + (1.0 - N.y) * 0.3;
      col *= mix(vec3(1.0), vec3(0.85, 0.92, 1.1), depth);

      if (closeUp) {
        // Trapped air bubbles
        float bubbles = smoothstep(0.85, 0.95, nUltraFine.r);
        col = mix(col, vec3(1.0), bubbles * 0.3 * grainFade);

        // Fracture lines
        float fractures = smoothstep(0.8, 0.92, nFine.g);
        col *= 1.0 - fractures * 0.08 * grainFade;

        // Internal blue-green variation
        float internal = nFine.b * 2.0 - 1.0;
        col *= vec3(1.0, 1.0 + internal * 0.03, 1.0 + internal * 0.05);
      }
      accRoughness = mix(accRoughness, 0.12, 0.35);
    }

    // --- JUNGLE GRASS (13): Dense tropical vegetation texture ---
    else if (dom == 13) {
      float health = nMacro.g;
      col *= mix(vec3(1.02, 0.98, 0.9), vec3(0.92, 1.05, 0.95), health);

      if (closeUp) {
        // Broader leaf shadows
        float leafShadow = smoothstep(0.25, 0.65, nFine.b);
        col *= mix(0.85, 1.1, leafShadow * grainFade);

        // Wet leaf sheen
        float sheen = pow(nUltraFine.g, 3.0);
        col += vec3(0.0, sheen * 0.04, 0.0) * grainFade;

        // Decaying matter
        float decay = smoothstep(0.88, 0.98, nUltraFine.a);
        col = mix(col, col * vec3(0.9, 0.85, 0.7), decay * 0.25 * grainFade);
      }
      col *= vec3(0.92, 0.98, 0.88);
    }

    // --- GLOWSTONE (14): Pulsing crystals ---
    else if (dom == 14) {
      float pulse = sin(uTime * 2.0 + vWorldPosition.x * 0.5 + vWorldPosition.z * 0.5) * 0.5 + 0.5;
      col *= 1.0 + pulse * 0.08;

      if (closeUp) {
        // Crystal facets
        float facet = smoothstep(0.5, 0.8, nFine.r);
        col *= 1.0 + facet * 0.15 * grainFade;

        // Glowing veins
        float veins = smoothstep(0.7, 0.9, nUltraFine.g);
        col += vec3(0.0, veins * 0.1, veins * 0.15) * grainFade;
      }
    }

    // --- OBSIDIAN (15): Volcanic glass ---
    else if (dom == 15) {
      float exposure = smoothstep(-0.3, 0.3, N.y);
      col *= mix(vec3(0.92), vec3(1.05), exposure);

      if (closeUp) {
        // Conchoidal fracture patterns
        float fracture = smoothstep(0.6, 0.85, nFine.g);
        col *= 1.0 + fracture * 0.1 * grainFade;

        // Slight iridescence
        float irid = nUltraFine.b * 2.0 - 1.0;
        col *= vec3(1.0 + irid * 0.02, 1.0, 1.0 - irid * 0.02);

        // Flow banding
        float flow = sin(vWorldPosition.y * 6.0 + nFine.r * 4.0);
        col *= 1.0 + flow * 0.02 * grainFade;
      }
      accRoughness = mix(accRoughness, 0.15, 0.4);
    }

    // --- MOSS (9): Fuzzy organic texture ---
    else if (dom == 9) {
      if (closeUp) {
        // Individual moss fronds
        float fronds = smoothstep(0.4, 0.7, nFine.r);
        col *= mix(0.9, 1.1, fronds * grainFade);

        // Spore capsules (slightly darker dots)
        float spores = smoothstep(0.88, 0.96, nUltraFine.g);
        col *= 1.0 - spores * 0.15 * grainFade;

        // Moisture variation
        float moist = nFine.b;
        col *= mix(1.0, 0.95, moist * grainFade);
      }
      accRoughness = mix(accRoughness, 0.95, 0.3);
    }
    float cav = clamp(vCavity, 0.0, 1.0) * clamp(uCavityStrength, 0.0, 2.0);
    col *= mix(1.0, 0.65, cav); accRoughness = mix(accRoughness, 1.0, cav * 0.25);

    // Apply terrain saturation boost (in-shader, not post-processing)
    // This affects base material colors before lighting, giving natural results
    col = adjustSaturation(col, uTerrainSaturation);

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
    // Apply combined wetness (simulation + humidity) to roughness - wet surfaces are shinier
    if (uWetnessEnabled > 0.5) {
      float roughnessWetness = max(vWetness, totalHumidity * wettabilityFactor * 0.7);
      accRoughness = mix(accRoughness, 0.2, roughnessWetness);
    }
    accRoughness = max(accRoughness, clamp(uRoughnessMin, 0.0, 1.0));
    if (dominantChannel == 8) accRoughness = 0.1;
    csm_Roughness = accRoughness;
    csm_Metalness = 0.0;
  }
`;
