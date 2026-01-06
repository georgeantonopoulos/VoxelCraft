/**
 * ProceduralGrassShader.ts
 *
 * GPU-based procedural grass placement shader.
 * Generates grass positions from instance ID + texture lookups,
 * eliminating the need for CPU-generated position arrays.
 *
 * Textures expected (all 32x32):
 * - uHeightMap: Float R32F surface height per cell
 * - uMaterialMask: Uint8 255=grass-friendly, 0=no grass
 * - uNormalMap: Uint8 RG packed XZ normal
 * - uBiomeMap: Uint8 biome ID (0-15)
 * - uCaveMask: Uint8 255=solid ground, 0=cave opening
 */

export const PROCEDURAL_GRASS_SHADER = {
  vertex: `
    uniform sampler2D uHeightMap;
    uniform sampler2D uMaterialMask;
    uniform sampler2D uNormalMap;
    uniform sampler2D uBiomeMap;
    uniform sampler2D uCaveMask;
    uniform float uTime;
    uniform vec2 uWindDir;
    uniform vec3 uChunkOffset;
    uniform float uVegType; // 0=grass_low, 1=grass_tall, 2=fern, 3=flower

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vVisible;
    varying float vTypeBlend; // For color variation

    // Deterministic hash functions
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    vec2 hash2(vec2 p) {
      return fract(sin(vec2(
        dot(p, vec2(127.1, 311.7)),
        dot(p, vec2(269.5, 183.3))
      )) * 43758.5453);
    }

    void main() {
      vUv = uv;

      // Decode grid position from instance ID
      float instanceId = float(gl_InstanceID);
      float gridX = mod(instanceId, 32.0);
      float gridZ = floor(instanceId / 32.0);

      // UV for texture sampling (center of cell)
      vec2 texUV = (vec2(gridX, gridZ) + 0.5) / 32.0;

      // Sample all textures
      float surfaceY = texture2D(uHeightMap, texUV).r;
      float matMask = texture2D(uMaterialMask, texUV).r;
      vec2 packedNormal = texture2D(uNormalMap, texUV).rg;
      float biomeId = texture2D(uBiomeMap, texUV).r * 255.0;
      float caveMask = texture2D(uCaveMask, texUV).r;

      // World cell ID for deterministic randomness
      vec2 cellId = vec2(gridX, gridZ) + uChunkOffset.xz;

      // Type selection via hash - each type claims a portion of instances
      float typeHash = hash(cellId + vec2(100.0, 200.0));
      float typeMatch = 0.0;

      // Type distribution: grass_low=70%, grass_tall=15%, fern=10%, flower=5%
      if (uVegType < 0.5) {
        // grass_low: hash 0.0 - 0.7
        typeMatch = step(typeHash, 0.7);
      } else if (uVegType < 1.5) {
        // grass_tall: hash 0.7 - 0.85
        typeMatch = step(0.7, typeHash) * step(typeHash, 0.85);
      } else if (uVegType < 2.5) {
        // fern: hash 0.85 - 0.95
        typeMatch = step(0.85, typeHash) * step(typeHash, 0.95);
      } else {
        // flower: hash 0.95 - 1.0
        typeMatch = step(0.95, typeHash);
      }

      // Unpack surface normal (XZ stored, Y derived)
      vec3 surfaceNormal;
      surfaceNormal.x = packedNormal.r * 2.0 - 1.0;
      surfaceNormal.z = packedNormal.g * 2.0 - 1.0;
      float xzSq = surfaceNormal.x * surfaceNormal.x + surfaceNormal.z * surfaceNormal.z;
      surfaceNormal.y = sqrt(max(0.0, 1.0 - xzSq));

      // Base position in chunk-local space
      vec3 basePos = vec3(gridX, surfaceY, gridZ);

      // Sub-cell jitter (deterministic, stays within cell bounds)
      vec2 jitter = hash2(cellId) - 0.5;
      basePos.x += jitter.x * 0.9;
      basePos.z += jitter.y * 0.9;

      // Slope compensation (match Surface Nets mesh offset)
      float slopeSink = (1.0 - surfaceNormal.y) * 0.75;
      basePos.y -= slopeSink;

      // Additional height jitter
      float heightJitter = (hash(cellId + vec2(50.0, 50.0)) - 0.5) * 0.15;
      basePos.y += heightJitter;

      // Random scale and rotation per instance
      float randScale = 0.7 + hash(cellId + vec2(1.0, 0.0)) * 0.6;
      float randRot = hash(cellId + vec2(2.0, 0.0)) * 6.28318;

      // Apply rotation around local Y
      vec3 pos = position;
      float c = cos(randRot);
      float s = sin(randRot);
      pos.xz = vec2(c * pos.x - s * pos.z, s * pos.x + c * pos.z);
      pos *= randScale;

      // Build TBN matrix to align grass to surface normal
      vec3 up = surfaceNormal;
      vec3 helper = abs(up.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
      vec3 tangent = normalize(cross(helper, up));
      vec3 bitangent = cross(up, tangent);
      mat3 alignMat = mat3(tangent, up, bitangent);
      pos = alignMat * pos;

      // Combine base + vertex position
      vec3 localPos = basePos + pos;
      vec3 worldPos = localPos + uChunkOffset;
      vWorldPos = worldPos;

      // Wind sway (stronger at blade tips)
      float windPhase = uTime * 0.8 + worldPos.x * 0.4 + worldPos.z * 0.2;
      float wind1 = sin(windPhase * 1.5);
      float wind2 = sin(windPhase * 4.0) * 0.3;
      float gust = sin(uTime * 2.0 - (worldPos.x * uWindDir.x + worldPos.z * uWindDir.y) * 0.3) * 0.5;
      float wind = wind1 + wind2 + gust;
      float swayMask = pow(uv.y, 1.5) * 0.12 * randScale;
      localPos.x += wind * swayMask * uWindDir.x;
      localPos.z += wind * swayMask * uWindDir.y;

      // Visibility checks
      float visible = 1.0;

      // Check material mask (grass-friendly surface)
      visible *= step(0.5, matMask);

      // Check cave mask (not over cave opening)
      visible *= step(0.5, caveMask);

      // Check valid height (not air column)
      visible *= step(-900.0, surfaceY);

      // Check above water level (5.0)
      visible *= step(5.0, surfaceY);

      // Check biome (no grass in desert=2,3, snow=5, ice=6)
      float badBiome = step(1.5, biomeId) * step(biomeId, 3.5); // Desert/RedDesert
      badBiome += step(4.5, biomeId) * step(biomeId, 6.5); // Snow/IceSpikes
      visible *= 1.0 - badBiome;

      // Check type match
      visible *= typeMatch;

      // Store visibility and type blend for fragment
      vVisible = visible;
      vTypeBlend = typeHash;

      // Output position (cull invisible by moving off-screen)
      csm_Position = visible > 0.5 ? localPos : vec3(0.0, -9999.0, 0.0);
    }
  `,

  fragment: `
    uniform sampler3D uNoiseTexture;
    uniform vec3 uSunDir;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uHeightFogEnabled;
    uniform float uHeightFogStrength;
    uniform float uHeightFogRange;
    uniform float uHeightFogOffset;
    uniform float uShaderFogStrength;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vVisible;
    varying float vTypeBlend;

    void main() {
      // Discard invisible fragments
      if (vVisible < 0.5) discard;

      // Sample noise for color variation
      vec3 noiseCoord = vWorldPos * 0.08;
      float noise = texture(uNoiseTexture, noiseCoord).r;
      float noise2 = texture(uNoiseTexture, noiseCoord * 2.5).g;

      // Base grass color with variation
      vec3 col = csm_DiffuseColor.rgb;
      col *= (0.9 + noise * 0.2);

      // Warm/cool color shift
      vec3 warmShift = vec3(1.05, 1.0, 0.9);
      vec3 coolShift = vec3(0.9, 1.0, 1.05);
      col = mix(col * coolShift, col * warmShift, noise2);

      // Vertical gradient (darker at base, brighter at tips)
      float gradient = smoothstep(0.0, 1.0, vUv.y);
      float ao = smoothstep(0.0, 0.7, vUv.y);
      col *= mix(0.7, 1.0, ao);

      // Tip brightening
      vec3 tipCol = col * 1.25;
      col = mix(col, tipCol, gradient);

      // Subsurface scattering approximation
      vec3 viewDir = normalize(vWorldPos - cameraPosition);
      float sss = pow(clamp(dot(viewDir, -uSunDir), 0.0, 1.0), 3.0) * gradient;
      col += csm_DiffuseColor.rgb * sss * 0.6;

      // Translucency effect
      float translucency = pow(gradient, 2.0) * 0.15;
      col += vec3(0.8, 1.0, 0.6) * translucency;

      // Fog (matching terrain fog)
      float fogDist = length(vWorldPos - cameraPosition);
      float fogRange = max(uFogFar - uFogNear, 1.0);
      float density = 4.0 / fogRange;
      float distFactor = max(0.0, fogDist - uFogNear);
      float fogAmt = 1.0 - exp(-pow(distFactor * density, 2.0));

      // Height fog
      if (uHeightFogEnabled > 0.5) {
        float heightFactor = smoothstep(uHeightFogOffset + uHeightFogRange, uHeightFogOffset, vWorldPos.y);
        float hDistFactor = smoothstep(5.0, 25.0, fogDist);
        float heightFog = heightFactor * uHeightFogStrength * hDistFactor;
        fogAmt = clamp(fogAmt + heightFog, 0.0, 1.0);
      }

      col = mix(col, uFogColor, fogAmt * uShaderFogStrength);

      csm_DiffuseColor = vec4(col, 1.0);
    }
  `
};

/**
 * Biome ID mapping (must match worker's BIOME_IDS)
 */
export const BIOME_IDS = {
  PLAINS: 0,
  THE_GROVE: 1,
  DESERT: 2,
  RED_DESERT: 3,
  JUNGLE: 4,
  SNOW: 5,
  ICE_SPIKES: 6,
  MOUNTAINS: 7,
  BEACH: 8,
  SAVANNA: 9,
  SKY_ISLANDS: 10
} as const;

/**
 * Vegetation type colors (matching VegetationConfig.ts)
 */
export const VEG_TYPE_COLORS = {
  grass_low: '#41a024',
  grass_tall: '#41a024',
  fern: '#2E7D32',
  flower: '#4444ff'
} as const;
