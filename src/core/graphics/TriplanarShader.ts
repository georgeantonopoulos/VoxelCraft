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

  // normalize() of a zero vector is undefined (NaN on most GPUs).
  vec3 safeNormalize3(vec3 v, vec3 fallback) {
    float len = length(v);
    return len > 1e-5 ? v / len : fallback;
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
      vec3 weatherDir = safeNormalize3(vec3(sin(worldPos.x * 0.3), 0.0, cos(worldPos.z * 0.3)), vec3(1.0, 0.0, 0.0));
      weatherDir = weatherDir - nn * dot(weatherDir, nn);

      nn = normalize(nn + strataDir * strataContrib * base + weatherDir * weatherContrib * base);
    }

    // --- 3. DIRT, CLAY, TERRACOTTA (Clumpy) ---
    else if (channel == 3.0 || channel == 7.0 || channel == 11.0) {
      // Single noise sample for clumps
      float clumps = cheapNoise(worldPos * 0.6) * 2.0 - 1.0;

      // Direction derived from position (no extra noise calls)
      vec3 g = safeNormalize3(vec3(
        sin(worldPos.x * 0.7 + 50.0),
        sin(worldPos.y * 0.7 + 25.0) * 0.5,
        cos(worldPos.z * 0.7 + 50.0)
      ), vec3(1.0, 0.0, 0.0));
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

      vec3 g = safeNormalize3(vec3(sin(worldPos.x * 0.8), 0.0, cos(worldPos.z * 0.8)), vec3(1.0, 0.0, 0.0));
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
  uniform float uPlayerGlow;             // Keeper's glow strength (caves, deep night)
  uniform vec3 uPlayerGlowColor;

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

  // === PBR texture arrays (see core/graphics/pbr) ===
  // A: albedo (sRGB) + height, B: tangent normal XY + roughness + AO.
  uniform highp sampler2DArray uPbrA;
  uniform highp sampler2DArray uPbrB;
  uniform float uPbrScale[16];

  // Triplanar PBR sample of one layer. Normals use the whiteout blend
  // (per-axis tangent normals reoriented onto the geometry normal).
  // uv.x and the tangent x flip together on negative-facing axes, which keeps
  // bumps pointing outwards on every side.
  void samplePbrLayer(int layer, vec3 p, vec3 N, vec3 tw, out vec4 albedoH, out vec3 nWorld, out float rough, out float ao) {
    float sc = uPbrScale[layer];
    float fl = float(layer);
    albedoH = vec4(0.0); nWorld = vec3(0.0); rough = 0.0; ao = 0.0;
    vec3 sgn = vec3(N.x < 0.0 ? 1.0 : -1.0, N.y < 0.0 ? -1.0 : 1.0, N.z < 0.0 ? -1.0 : 1.0);
    if (tw.x > 0.02) {
      vec2 uv = vec2(p.z * sgn.x, p.y) * sc;
      vec4 a = texture(uPbrA, vec3(uv, fl));
      vec4 b = texture(uPbrB, vec3(uv, fl));
      vec2 t = (b.xy * 2.0 - 1.0) * vec2(sgn.x, 1.0);
      vec3 w = vec3(t + N.zy, sqrt(max(1.0 - dot(t, t), 0.0)) * N.x);
      albedoH += a * tw.x; nWorld += w.zyx * tw.x; rough += b.z * tw.x; ao += b.w * tw.x;
    }
    if (tw.y > 0.02) {
      vec2 uv = vec2(p.x * sgn.y, p.z) * sc;
      vec4 a = texture(uPbrA, vec3(uv, fl));
      vec4 b = texture(uPbrB, vec3(uv, fl));
      vec2 t = (b.xy * 2.0 - 1.0) * vec2(sgn.y, 1.0);
      vec3 w = vec3(t + N.xz, sqrt(max(1.0 - dot(t, t), 0.0)) * N.y);
      albedoH += a * tw.y; nWorld += w.xzy * tw.y; rough += b.z * tw.y; ao += b.w * tw.y;
    }
    if (tw.z > 0.02) {
      vec2 uv = vec2(p.x * sgn.z, p.y) * sc;
      vec4 a = texture(uPbrA, vec3(uv, fl));
      vec4 b = texture(uPbrB, vec3(uv, fl));
      vec2 t = (b.xy * 2.0 - 1.0) * vec2(sgn.z, 1.0);
      vec3 w = vec3(t + N.xy, sqrt(max(1.0 - dot(t, t), 0.0)) * N.z);
      albedoH += a * tw.z; nWorld += w.xyz * tw.z; rough += b.z * tw.z; ao += b.w * tw.z;
    }
    float tsum = max(tw.x * step(0.02, tw.x) + tw.y * step(0.02, tw.y) + tw.z * step(0.02, tw.z), 1e-4);
    albedoH /= tsum; rough /= tsum; ao /= tsum;
    float nl = length(nWorld);
    nWorld = nl > 1e-5 ? nWorld / nl : N;
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
      // Single-channel pattern: per-channel UV offsets (dispersion) read as
      // oil-slick rainbows through clear shallow water. Real caustics are ~white.
      float c = sampleCausticPattern(uv, ang, tz1, tz2);
      vec3 finalC = vec3(c) * vec3(1.0, 0.98, 0.9);
      finalC += c * c * 0.8; // sharpen the bright filaments
      finalC *= 3.2;
      float depthFade = exp(-distToSurface * 0.18); 
      return finalC * depthFade;
  }

  void main() {
    vec3 N = safeNormalize(vWorldNormal);
    float distSq = dot(vWorldPosition - cameraPosition, vWorldPosition - cameraPosition);
    bool lowDetail = distSq > 1024.0; // Beyond 32 units (1 chunk)

    vec4 nMacro = texture(uNoiseTexture, vWorldPosition * 0.012 + vec3(0.11, 0.07, 0.03));
    float macro = (nMacro.r * 2.0 - 1.0) * clamp(uMacroStrength, 0.0, 2.0);

    // === HUMIDITY FIELD SYSTEM ===
    // Two-layer humidity: base (biome+water) + tree boost (Sacred Grove), baked per vertex.
    float totalHumidity = clamp(vBaseHumidity + vTreeHumidityBoost, 0.0, 1.0);
    // Only lush up soil that already exists here (adding grass weight unconditionally
    // tinted pure sand, snow and cave rock near water green).
    // Smooth gate: a hard step() here drew a saw-tooth grass edge along the
    // zig-zag contour where interpolated soil weight crosses ~0.
    float soilPresent = smoothstep(0.05, 0.5, vWb.x + vWa.w);

    // === MATERIAL SELECTION: top two channels by (humidity-adjusted) weight ===
    float w[16];
    w[0] = vWa.x; w[1] = vWa.y; w[2] = vWa.z - totalHumidity * 0.2; w[3] = vWa.w + totalHumidity * 0.3 * soilPresent;
    w[4] = vWb.x + totalHumidity * 0.6 * soilPresent; w[5] = vWb.y; w[6] = vWb.z; w[7] = vWb.w;
    w[8] = vWc.x; w[9] = vWc.y; w[10] = vWc.z - totalHumidity * 0.8; w[11] = vWc.w - totalHumidity * 0.5;
    w[12] = vWd.x; w[13] = vWd.y; w[14] = vWd.z; w[15] = vWd.w;
    int c0 = 2; int c1 = 2; float w0 = -1.0; float w1 = -1.0; float w2 = 0.0;
    for (int i = 1; i < 16; i++) {
      if (i == 8) continue; // water is rendered by the water mesh
      float wi = w[i];
      if (wi > w0) { w2 = max(w2, w1); c1 = c0; w1 = w0; c0 = i; w0 = wi; }
      else if (wi > w1) { w2 = max(w2, w1); c1 = i; w1 = wi; }
      else w2 = max(w2, wi);
    }
    w0 = max(w0, 0.0); w1 = max(w1, 0.0);
    // Only two layers are sampled. Measure the second against the third so it fades
    // in/out continuously when the pair changes (no seams along triangle edges).
    w1 = max(w1 - w2, 0.0);
    if (w0 < 0.001) { c0 = 2; w0 = 1.0; }

    // === TRIPLANAR PBR ===
    vec3 tw = pow(abs(N), vec3(6.0));
    tw /= max(dot(tw, vec3(1.0)), 1e-5);
    vec3 P = vWorldPosition;

    vec4 A0; vec3 N0; float r0; float ao0;
    samplePbrLayer(c0, P, N, tw, A0, N0, r0, ao0);

    vec4 albedoH = A0; vec3 Nm = N0; float rough = r0; float ao = ao0;
    float wSum = w0 + w1;
    float kLayer1 = 0.0; // share of the second layer in the final blend (for anti-tiling)
    if (w1 > 0.02 && !(distSq > 6400.0 && w1 < 0.25 * wSum)) {
      vec4 A1; vec3 N1; float r1; float ao1;
      samplePbrLayer(c1, P, N, tw, A1, N1, r1, ao1);
      // Height blend: the taller texel wins near the boundary (stones poke out of
      // grass, sand fills cracks) instead of a soft cross-fade.
      // Noise-jittered weights break up boundaries that follow the voxel grid.
      // Strong enough to move the boundary ~1 m: per-vertex weights ramp across a
      // single triangle, which otherwise shows as a saw-tooth edge.
      float jitter = (texture(uNoiseTexture, P * 0.07 + vec3(0.3, 0.1, 0.7)).g - 0.5) * 1.1
                   + (texture(uNoiseTexture, P * 0.45 + vec3(0.8, 0.4, 0.2)).b - 0.5) * 0.8;
      // The jitter must vanish where the second layer's weight does: at full
      // strength it could make that layer win outright right up to the
      // w1 > 0.02 cutoff above, which follows the triangles and drew hard,
      // jagged sand/grass lines. Fading it in keeps the boundary continuous
      // while the middle of the transition still follows the noise.
      float share1 = w1 / wSum;
      jitter *= smoothstep(0.02, 0.22, share1);
      // Tie the jitter to a fixed layer (the lower channel index), not to "c0":
      // where the two layers swap dominance, c0/c1 swap too, and a c0-relative
      // jitter flipped sign there (a 2x-jitter jump along a triangle-aligned line).
      if (c0 > c1) jitter = -jitter;
      float b0 = clamp(1.0 - share1 + jitter, 0.0, 1.0), b1 = 1.0 - b0;
      float h0 = A0.a + b0, h1 = A1.a + b1;
      float top = max(h0, h1) - 0.3;
      float k0 = max(h0 - top, 0.0), k1 = max(h1 - top, 0.0);
      // A tall texel in a barely-present layer must not pop in at the cutoff either.
      k1 *= smoothstep(0.02, 0.08, share1);
      float kInv = 1.0 / max(k0 + k1, 1e-4);
      k0 *= kInv; k1 *= kInv;
      kLayer1 = k1;
      albedoH = A0 * k0 + A1 * k1;
      Nm = normalize(N0 * k0 + N1 * k1);
      rough = r0 * k0 + r1 * k1;
      ao = ao0 * k0 + ao1 * k1;
    }

    // Anti-tiling: blend in a second, larger-scale sample of each blended layer's
    // albedo, driven by low-frequency noise, so repeats don't line up. Both
    // layers are sampled in their blend proportion: using only the dominant
    // layer (c0) made 45% of the colour jump where the dominant layer swaps,
    // a line that follows the triangles (jagged sand/grass edges).
    if (!lowDetail || distSq < 9216.0) {
      vec3 twd = step(max(tw.yzx, tw.zxy), tw); // dominant axis
      vec2 uvBase = (twd.x > 0.5 ? P.zy : (twd.y > 0.5 ? P.xz : P.xy)) * 0.29;
      // Mip bias keeps only broad colour variation (fine ripples/cracks at 3.5x
      // scale read as giant stripes).
      vec3 far = texture(uPbrA, vec3(uvBase * uPbrScale[c0] + vec2(0.37, 0.61), float(c0)), 3.0).rgb;
      if (kLayer1 > 0.001) {
        vec3 far1 = texture(uPbrA, vec3(uvBase * uPbrScale[c1] + vec2(0.37, 0.61), float(c1)), 3.0).rgb;
        far = mix(far, far1, kLayer1);
      }
      float mixK = smoothstep(0.35, 0.75, nMacro.g) * 0.45;
      albedoH.rgb = mix(albedoH.rgb, far, mixK);
    }

    vec3 accColor = albedoH.rgb;
    float accRoughness = rough;
    float accEmission = (c0 == 14 ? w0 : 0.0) + (c1 == 14 ? w1 : 0.0);
    int dominantChannel = c0;
    // Glow stone emits only from its bright veins, not the dark host rock.
    vec3 glow = accEmission * 2.0 * accColor * smoothstep(0.3, 0.6, max(accColor.r, max(accColor.g, accColor.b)));
    vec3 col = accColor;
    // Texture AO shows as contact shadow in crevices.
    col *= mix(1.0, ao, 0.65);
    N = Nm;

    // === MOSS (simulation mossiness + mossy stone) ===
    float mossMatWeight = vWc.y; float effectiveMoss = max(vMossiness, mossMatWeight);
    if (uMossEnabled > 0.5 && effectiveMoss > 0.001 && c0 != 9) {
      float organicNoise = texture(uNoiseTexture, P * 0.35).r;
      float threshold = 1.0 - effectiveMoss;
      // Moss settles in low texels first.
      float mossMix = smoothstep(threshold - 0.4, threshold + 0.4, organicNoise + (0.5 - albedoH.a) * 0.6);
      col = mix(col, uColorMoss * (0.65 + 0.5 * albedoH.a), mossMix);
      accRoughness = mix(accRoughness, 0.92, mossMix);
    }

    // === HUMIDITY-BASED VISUAL WETNESS ===
    // Sand, stone, dirt, clay get darker and shinier; grass, snow, ice don't.
    float wettableMaterials = vWa.z + vWa.w + vWb.y + vWb.w + vWc.z + vWc.w;
    float nonWettableMaterials = vWb.x + vWb.z + vWd.y;
    float wettabilityFactor = clamp(wettableMaterials / max(wettableMaterials + nonWettableMaterials, 0.001), 0.0, 1.0);
    float humidityWetness = totalHumidity * wettabilityFactor * 0.7;
    float combinedWetness = max(vWetness, humidityWetness);
    // Water pools in low texels: wet darkening follows the height map.
    float wetMask = combinedWetness * mix(1.0, 1.4 - albedoH.a, 0.6);
    if (uWetnessEnabled > 0.5) col = mix(col, col * 0.5, clamp(wetMask, 0.0, 1.0) * 0.9);
    col *= (1.0 + macro * 0.06); accRoughness += macro * 0.05;


    float cav = clamp(vCavity, 0.0, 1.0) * clamp(uCavityStrength, 0.0, 2.0);
    col *= mix(1.0, 0.65, cav); accRoughness = mix(accRoughness, 1.0, cav * 0.25);

    // Apply terrain saturation boost (in-shader, not post-processing)
    // This affects base material colors before lighting, giving natural results
    col = adjustSaturation(col, uTerrainSaturation);

    // Keeper's glow: a soft light around the camera underground and at deep
    // night. Emissive, because baked GI is ~0 in caves and scales every lit
    // term, so a real point light could never show there.
    vec3 keeperGlow = vec3(0.0);
    if (uPlayerGlow > 0.001) {
      vec3 toCam = cameraPosition - vWorldPosition;
      float d = length(toCam);
      float fall = (1.0 / (1.0 + d * d * 0.08)) * (1.0 - smoothstep(6.0, 16.0, d));
      float facing = max(dot(N, toCam / max(d, 1e-3)), 0.0) * 0.75 + 0.25;
      keeperGlow = col * uPlayerGlowColor * (uPlayerGlow * fall * facing);
    }

    // Apply voxel-based global illumination
    vec3 giLight = getGILight();
    col *= giLight;

    col = clamp(col, 0.0, 5.0); col += glow;
    if (!lowDetail && vWetness > 0.05 && vWorldPosition.y < uWaterLevel && uSunDirection.y > 0.0) {
        float waterDepth = uWaterLevel - vWorldPosition.y;
        // Fade in with real depth: ground a few cm under sea level is usually dry
        // (no water sheet there), and full caustics drew a white shimmer on it.
        float depthMask = (1.0 - smoothstep(0.0, 16.0, waterDepth)) * smoothstep(0.35, 0.9, waterDepth);
        float normalMask = clamp(dot(N, uSunDirection), 0.0, 1.0);
        float openMask = 1.0 - smoothstep(0.0, 0.3, vCavity);
        float floorMask = smoothstep(0.25, 0.65, N.y);
        if (depthMask > 0.01 && normalMask > 0.01 && openMask > 0.01 && floorMask > 0.01) {
             vec3 caus = getRealisticCaustics(vWorldPosition, uSunDirection, uTime);
             float variation = texture(uNoiseTexture, vec3(vWorldPosition.xz * 0.008, 0.0)).b;
             float variationMask = smoothstep(0.35, 0.65, variation);
             vec3 finalCaustic = caus * depthMask * normalMask * openMask * floorMask * variationMask;
             col += finalCaustic * 0.12; // a gentle shimmer, not bright worm lines
        }
    } 
    if (uShaderFogEnabled > 0.5) {
      float fogDist = length(vWorldPosition - cameraPosition);

      // === BIOME-AWARE FOG SYSTEM ===

      // 1. Base density from biome (deserts thin, jungles thick)
      float biomeDensity = uBiomeFogEnabled > 0.5 ? uBiomeFogDensityMul : 1.0;

      // 2. Exponential Squared Fog with biome modulation
      float fogRange = max(uFogFar - uFogNear, 1.0);
      // Clear near field, soft distance: ~60% at mid range, ~99% at fog far.
      float density = (2.2 / fogRange) * biomeDensity;
      float distFactor = max(0.0, fogDist - uFogNear);
      float baseFog = 1.0 - exp(-pow(distFactor * density, 2.0));

      float fogAmt = baseFog;

      // 3. Height Fog with biome modulation and valley pooling
      if (uHeightFogEnabled > 0.5) {
          float biomeHeightMul = uBiomeFogEnabled > 0.5 ? uBiomeFogHeightMul : 1.0;

          // Base height factor: 1.0 at floor, 0.0 at ceiling
          float heightFactor = 1.0 - smoothstep(uHeightFogOffset, uHeightFogOffset + uHeightFogRange, vWorldPosition.y);

          // Valley pooling: use world-space noise to create natural fog accumulation
          // Low-frequency noise simulates fog pooling in terrain depressions
          float valleyPool = 1.0;
          if (heightFactor > 0.001 && uBiomeFogEnabled > 0.5) {
              vec4 valleyNoise = texture(uNoiseTexture, vec3(vWorldPosition.xz * 0.008, 0.1));
              valleyPool = valleyNoise.r * 0.4 + 0.6; // 0.6 to 1.0 range
          }

          // Boost factor in valleys (lower areas get more fog)
          float valleyBoost = mix(1.0, valleyPool * 1.3, heightFactor);

          // Distance factor: Don't fog the player's feet.
          // Fade in height fog from 5m to 25m.
          float hDistFactor = smoothstep(18.0, 60.0, fogDist);

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

      // Fog only glows where light reaches: inside caves (baked GI ~0) it fades
      // to dark, so a cave mouth seen from the surface is a dark opening, not a
      // white hole of fully fogged walls.
      float fogLit = smoothstep(0.03, 0.45, dot(giLight, vec3(0.3333)));
      tintedFogColor *= mix(0.05, 1.0, fogLit);

      col = mix(col, tintedFogColor, fogAmt * uShaderFogStrength);
    }
    csm_DiffuseColor = vec4(col, clamp(uOpacity, 0.0, 1.0));
    csm_Emissive = glow + keeperGlow;
    // Apply combined wetness (simulation + humidity) to roughness - wet surfaces are shinier
    if (uWetnessEnabled > 0.5) {
      float roughnessWetness = max(vWetness, totalHumidity * wettabilityFactor * 0.7);
      // Damp soil, not a mirror: at 0.2 wet ground below sea level caught the
      // sun as a white glare patch.
      accRoughness = mix(accRoughness, 0.45, roughnessWetness * 0.8);
    }
    accRoughness = max(accRoughness, clamp(uRoughnessMin, 0.0, 1.0));
    csm_Roughness = accRoughness;
    // Per-pixel normal from the PBR maps (view space) and texture AO for indirect light.
    csm_FragNormal = normalize((viewMatrix * vec4(N, 0.0)).xyz);
    // CSM semantics: csm_AO is the occlusion AMOUNT (indirectDiffuse *= 1 - csm_AO).
    csm_AO = 1.0 - ao;

    // Debug views (window.__terrainView). Applied as overrides at the end: CSM
    // inlines this main(), so an early return would skip writing the output.
    if (uWeightsView != 0) {
      vec3 dbg = vec3(0.5);
      if (uWeightsView == 1) dbg = vec3(vWb.z);
      else if (uWeightsView == 2) dbg = vec3(vWb.x);
      else if (uWeightsView == 3) dbg = vec3(clamp((vWb.z - vWb.x) * 2.0 + 0.5, 0.0, 1.0));
      else if (uWeightsView == 4) dbg = vec3(float(c0) / 15.0, float(c1) / 15.0, w1 / max(w0 + w1, 1e-4));
      else if (uWeightsView == 5) dbg = getGILight();
      else if (uWeightsView == 6) dbg = accColor;
      else if (uWeightsView == 7) dbg = N * 0.5 + 0.5;
      csm_DiffuseColor = vec4(0.0, 0.0, 0.0, uOpacity);
      csm_Emissive = dbg;
      csm_Roughness = 1.0;
      csm_AO = 1.0;
    }
    csm_Metalness = 0.0;
  }
`;
