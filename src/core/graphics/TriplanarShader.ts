export const triplanarVertexShader = `
  attribute vec4 aMatWeightsA;
  attribute vec4 aMatWeightsB;
  attribute vec4 aMatWeightsC;
  attribute vec4 aMatWeightsD;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;
  attribute float aVoxelCavity;

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

  vec2 safeNormalize2(vec2 v) {
    float len = length(v);
    if (len < 0.0001) return vec2(1.0, 0.0);
    return v / len;
  }

  vec3 applyDominantNormal(vec3 n, vec3 worldPos, float channel, float weight) {
    vec3 nn = normalize(n);
    vec2 wind = safeNormalize2(uWindDirXZ);
    float w = clamp(weight, 0.0, 1.0);
    // Base strength boost to ensure visibility
    float base = uNormalStrength * (0.6 + 0.4 * w);

    // --- 1. SAND & RED SAND (Ripples) ---
    // Keep existing wind-aligned ripples as they are static logic-wise
    if (channel == 5.0 || channel == 10.0) {
      float flatness = pow(clamp(nn.y, 0.0, 1.0), 2.4);
      float freq = 2.8;
      float warp = sin(worldPos.x * 0.06 + worldPos.z * 0.05) * 0.55;
      float phase = dot(worldPos.xz, wind) * freq + warp;
      float c = cos(phase);
      vec3 g = vec3(wind.x, 0.0, wind.y);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (c * base * flatness * 0.4));
    }
    // --- 2. ROCK, BEDROCK, OBSIDIAN (Stratified Layers) ---
    // Sharp horizontal ridges to simulate sedimentary rock layers.
    else if (channel == 2.0 || channel == 1.0 || channel == 15.0 || channel == 9.0) {
      float freq = 3.5;
      float warp = sin(worldPos.x * 0.15 + worldPos.z * 0.1) * 0.8;
      float phase = worldPos.y * freq + warp;
      float folded = abs(mod(phase, 2.0) - 1.0); // Triangle wave
      float ridge = smoothstep(0.3, 0.7, folded); // Contrast boost
      vec3 g = vec3(0.0, 1.0, 0.0);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * ((ridge - 0.5) * base * 0.7)); // Strong bump
    }
    // --- 3. DIRT, CLAY, TERRACOTTA (Lumpy Noise) ---
    else if (channel == 3.0 || channel == 7.0 || channel == 11.0) {
      float f = 3.5;
      float n = sin(worldPos.x * f) * sin(worldPos.z * f); // Grid bumps
      float n2 = sin(worldPos.x * f * 2.0 + worldPos.z) * 0.5; // Detail
      float bump = n + n2;
      vec3 g = vec3(1.0, 0.0, 1.0); // Diagonal displacement
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (bump * base * 0.4));
    }
    // --- 4. GRASS & JUNGLE GRASS (Mown/Directional Ridges) ---
    // STATIC now - removed time animation. 
    // Uses parallel ridges to simulate mowed grass or directional growth.
    else if (channel == 4.0 || channel == 13.0) {
      float freq = 2.0;
      // Fixed phase based on world position only
      float phase = (worldPos.x + worldPos.z * 0.5) * freq; 
      float ridge = sin(phase);
      // Sharpen tops
      ridge = sign(ridge) * pow(abs(ridge), 0.6);
      
      vec3 g = vec3(1.0, 0.0, 0.5); // Fixed direction
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (ridge * base * 0.5)); // Strong visible ridges
    }
    // --- 5. SNOW & ICE (Drifts) ---
    else if (channel == 6.0 || channel == 12.0) {
      float freq = 0.5;
      float drift = sin(worldPos.x * freq + sin(worldPos.z * freq));
      vec3 g = vec3(1.0, 0.0, 1.0);
      g = g - nn * dot(g, nn);
      nn = normalize(nn + g * (drift * base * 0.4));
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

  vec2 safeNormalize2(vec2 v) {
      float len = length(v);
      if (len < 0.0001) return vec2(1.0, 0.0);
      return v / len;
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
    int dom = int(floor(vDominantChannel + 0.5));
    vec2 wind = safeNormalize2(uWindDirXZ);
    if (dom == 5 || dom == 10) {
      float rip = sin(dot(vWorldPosition.xz, wind) * 2.8 + (nMacro.g * 2.0 - 1.0) * 0.6);
      float mott = (nMid.g * 2.0 - 1.0);
      col *= 1.0 + (rip * 0.03 + mott * 0.02); accRoughness = mix(accRoughness, 0.92, 0.35);
    } else if (dom == 2 || dom == 1 || dom == 15) {
      float bands = sin(vWorldPosition.y * 1.4 + (nMacro.b * 2.0 - 1.0) * 1.2);
      float cracks = pow(1.0 - abs(nHigh.g * 2.0 - 1.0), 3.5);
      col *= 1.0 + bands * 0.02; col *= 1.0 - cracks * 0.08; accRoughness += cracks * 0.08;
    } else if (dom == 3 || dom == 7 || dom == 11) {
      float clump = (nHigh.r * 2.0 - 1.0);
      col *= 1.0 + clump * 0.03; col *= 1.0 - smoothstep(0.2, 0.9, abs(clump)) * 0.06; accRoughness = mix(accRoughness, 0.95, 0.15);
    } else if (dom == 6) {
      col = mix(col, col * vec3(0.92, 0.96, 1.04), 0.22); accRoughness = mix(accRoughness, 0.98, 0.45);
    } else if (dom == 12) {
      col = mix(col, col * vec3(0.92, 0.98, 1.06), 0.18); accRoughness = mix(accRoughness, 0.12, 0.35);
    } else if (dom == 14) col *= 1.0 + (nMacro.a * 2.0 - 1.0) * 0.03;
    else if (dom == 4 || dom == 13) col *= 1.0 + (nMacro.g * 2.0 - 1.0) * 0.03;
    float cav = clamp(vCavity, 0.0, 1.0) * clamp(uCavityStrength, 0.0, 2.0);
    col *= mix(1.0, 0.65, cav); accRoughness = mix(accRoughness, 1.0, cav * 0.25);
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
      
      // Exponential Squared Fog (Tip 1)
      // d = 4.0 / fogRange ensures near-full opacity at the far distance
      float fogRange = max(uFogFar - uFogNear, 1.0);
      float density = 4.0 / fogRange; 
      float distFactor = max(0.0, fogDist - uFogNear);
      float baseFog = 1.0 - exp(-pow(distFactor * density, 2.0));
      
      float fogAmt = baseFog;

      // Height Fog logic (Tip 3/4)
      if (uHeightFogEnabled > 0.5) {
          // Height factor: 1.0 at floor, 0.0 at ceiling
          float heightFactor = smoothstep(uHeightFogOffset + uHeightFogRange, uHeightFogOffset, vWorldPosition.y);
          
          // Distance factor: Don't fog the player's feet. 
          // Fade in height fog from 5m to 25m.
          float hDistFactor = smoothstep(5.0, 25.0, fogDist);
          
          float heightFog = heightFactor * uHeightFogStrength * hDistFactor;
          fogAmt = clamp(fogAmt + heightFog, 0.0, 1.0);
      }

      col = mix(col, uFogColor, fogAmt * uShaderFogStrength);
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
