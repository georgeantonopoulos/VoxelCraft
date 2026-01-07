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

// Grid size constant - must match GRASS_GRID_SIZE in ProceduralGrassLayer.tsx
// 80×80 = 6400 instances per chunk - balanced density/performance
export const GRASS_GRID_SIZE = 80;

export const PROCEDURAL_GRASS_SHADER = {
  vertex: `
    uniform sampler2D uHeightMap;
    uniform sampler2D uMaterialMask;
    uniform sampler2D uNormalMap;
    uniform sampler2D uBiomeMap;
    uniform sampler2D uCaveMask;
    uniform sampler3D uLightGrid; // 8x32x8 3D light grid for GI
    uniform float uTime;
    uniform vec2 uWindDir;
    uniform vec3 uChunkOffset;
    uniform float uVegType; // 0-4: grass_low, grass_tall, fern, flower, shrub
    uniform float uGridSize; // Grid resolution (e.g., 80 for 80x80)
    uniform float uGIEnabled; // Toggle for GI (0 or 1)
    uniform float uGIIntensity; // GI intensity multiplier

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vVisible;
    varying float vTypeBlend; // For color variation
    varying vec3 vGILight; // GI light color from light grid
    varying float vBiomeId; // Pass biome to fragment for color tinting

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
      // Grid is uGridSize x uGridSize (e.g., 64x64 = 4096 instances)
      float instanceId = float(gl_InstanceID);
      float gridX = mod(instanceId, uGridSize);
      float gridZ = floor(instanceId / uGridSize);

      // Convert grid position to chunk-local coordinates (0-32 range)
      // This maps the denser grid onto the 32-unit chunk
      float chunkX = gridX * (32.0 / uGridSize);
      float chunkZ = gridZ * (32.0 / uGridSize);

      // UV for texture sampling (textures are 32x32)
      vec2 texUV = (vec2(chunkX, chunkZ) + 0.5) / 32.0;

      // Sample all textures
      float surfaceY = texture2D(uHeightMap, texUV).r;
      float matMask = texture2D(uMaterialMask, texUV).r;
      vec2 packedNormal = texture2D(uNormalMap, texUV).rg;
      float biomeId = texture2D(uBiomeMap, texUV).r * 255.0;
      float caveMask = texture2D(uCaveMask, texUV).r;

      // World cell ID for deterministic randomness (use grid position for unique hash per instance)
      vec2 cellId = vec2(gridX, gridZ) + uChunkOffset.xz * (uGridSize / 32.0);

      // Pass biome to fragment shader for color tinting
      vBiomeId = biomeId;

      // Type selection via hash - biome-aware distribution
      float typeHash = hash(cellId + vec2(100.0, 200.0));

      // Biome-specific vegetation type distribution using cumulative probability ranges
      // Types: 0=grass_low, 1=grass_tall, 2=fern, 3=flower, 4=shrub (5 types for performance)
      // Each biome defines 5 cumulative thresholds

      // Get start and end thresholds for current type in current biome
      float typeStart = 0.0;
      float typeEnd = 0.0;
      int t = int(uVegType);

      // Simplified biome-type lookup with 5 types
      if (biomeId < 0.5) {
        // PLAINS: grass dominant with flowers
        float thresholds[5] = float[5](0.55, 0.75, 0.85, 0.95, 1.00);
        typeStart = (t > 0) ? thresholds[t-1] : 0.0;
        typeEnd = thresholds[t];
      } else if (biomeId < 1.5) {
        // THE_GROVE: lush with more ferns and flowers
        float thresholds[5] = float[5](0.40, 0.60, 0.80, 0.95, 1.00);
        typeStart = (t > 0) ? thresholds[t-1] : 0.0;
        typeEnd = thresholds[t];
      } else if (biomeId > 3.5 && biomeId < 4.5) {
        // JUNGLE: fern-heavy with shrubs
        float thresholds[5] = float[5](0.20, 0.30, 0.70, 0.80, 1.00);
        typeStart = (t > 0) ? thresholds[t-1] : 0.0;
        typeEnd = thresholds[t];
      } else if (biomeId > 6.5 && biomeId < 7.5) {
        // MOUNTAINS: sparse grass with hardy shrubs
        float thresholds[5] = float[5](0.60, 0.70, 0.75, 0.85, 1.00);
        typeStart = (t > 0) ? thresholds[t-1] : 0.0;
        typeEnd = thresholds[t];
      } else if (biomeId > 8.5 && biomeId < 9.5) {
        // SAVANNA: tall grass dominant
        float thresholds[5] = float[5](0.25, 0.80, 0.85, 0.90, 1.00);
        typeStart = (t > 0) ? thresholds[t-1] : 0.0;
        typeEnd = thresholds[t];
      } else if (biomeId > 9.5) {
        // SKY_ISLANDS: mystical with flowers
        float thresholds[5] = float[5](0.35, 0.55, 0.65, 0.90, 1.00);
        typeStart = (t > 0) ? thresholds[t-1] : 0.0;
        typeEnd = thresholds[t];
      } else {
        // Default fallback
        float thresholds[5] = float[5](0.60, 0.80, 0.90, 1.00, 1.00);
        typeStart = (t > 0) ? thresholds[t-1] : 0.0;
        typeEnd = thresholds[t];
      }

      // Type matches if hash falls within this type's probability range
      float typeMatch = step(typeStart, typeHash) * step(typeHash, typeEnd);

      // Unpack surface normal (XZ stored, Y derived)
      vec3 surfaceNormal;
      surfaceNormal.x = packedNormal.r * 2.0 - 1.0;
      surfaceNormal.z = packedNormal.g * 2.0 - 1.0;
      float xzSq = surfaceNormal.x * surfaceNormal.x + surfaceNormal.z * surfaceNormal.z;
      surfaceNormal.y = sqrt(max(0.0, 1.0 - xzSq));

      // Base position in chunk-local space (use chunk coordinates, not grid)
      vec3 basePos = vec3(chunkX, surfaceY, chunkZ);

      // Sub-cell jitter (deterministic, stays within cell bounds)
      // Reduce jitter range proportionally to cell size
      float cellSize = 32.0 / uGridSize;
      vec2 jitter = hash2(cellId) - 0.5;
      basePos.x += jitter.x * cellSize * 0.9;
      basePos.z += jitter.y * cellSize * 0.9;

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

      // Check biome (no grass in desert=2,3, snow=5, ice=6, beach=8)
      float badBiome = step(1.5, biomeId) * step(biomeId, 3.5); // Desert/RedDesert
      badBiome += step(4.5, biomeId) * step(biomeId, 6.5); // Snow/IceSpikes
      badBiome += step(7.5, biomeId) * step(biomeId, 8.5); // Beach
      visible *= 1.0 - badBiome;

      // Check type match
      visible *= typeMatch;

      // Sample GI light grid
      // Light grid is 8x32x8 cells, each cell covers 4 voxels
      // Convert chunk-local position to light grid UV (0-1)
      // chunkX/chunkZ are in 0-32 range, surfaceY is world Y
      // MESH_Y_OFFSET = -35, so local Y = worldY + 35
      float lightCellSize = 4.0; // LIGHT_CELL_SIZE
      float lightGridXZ = 8.0;   // LIGHT_GRID_SIZE_XZ
      float lightGridY = 32.0;   // LIGHT_GRID_SIZE_Y

      // Convert to light grid coordinates
      float lgX = chunkX / lightCellSize / lightGridXZ;
      float lgY = (surfaceY + 35.0) / lightCellSize / lightGridY; // +35 to convert to local Y
      float lgZ = chunkZ / lightCellSize / lightGridXZ;

      // Clamp to valid range
      vec3 lightUV = clamp(vec3(lgX, lgY, lgZ), 0.0, 1.0);

      // Sample light grid (default to neutral if GI disabled)
      if (uGIEnabled > 0.5) {
        vec4 lightSample = texture(uLightGrid, lightUV);
        vGILight = lightSample.rgb * uGIIntensity;
      } else {
        vGILight = vec3(1.0);
      }

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
    uniform float uGIEnabled;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vVisible;
    varying float vTypeBlend;
    varying vec3 vGILight;
    varying float vBiomeId;

    // Biome-specific color tinting
    vec3 getBiomeTint(float biomeId) {
      // JUNGLE (4): Deep saturated green
      if (biomeId > 3.5 && biomeId < 4.5) return vec3(0.85, 1.0, 0.75);

      // SAVANNA (9): Warm golden
      if (biomeId > 8.5 && biomeId < 9.5) return vec3(1.15, 1.05, 0.70);

      // MOUNTAINS (7): Cool blue-green
      if (biomeId > 6.5 && biomeId < 7.5) return vec3(0.92, 0.97, 1.05);

      // THE_GROVE (1): Lush vibrant green
      if (biomeId > 0.5 && biomeId < 1.5) return vec3(0.90, 1.08, 0.85);

      // SKY_ISLANDS (10): Ethereal mint
      if (biomeId > 9.5) return vec3(0.95, 1.10, 1.05);

      return vec3(1.0); // Neutral for plains and others
    }

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

      // Apply biome-specific color tinting
      col *= getBiomeTint(vBiomeId);

      // Warm/cool color shift (noise-based patches)
      vec3 warmShift = vec3(1.05, 1.0, 0.9);
      vec3 coolShift = vec3(0.9, 1.0, 1.05);
      col = mix(col * coolShift, col * warmShift, noise2);

      // Savanna-specific golden tips
      if (vBiomeId > 8.5 && vBiomeId < 9.5) {
        float tipYellow = smoothstep(0.5, 1.0, vUv.y);
        col = mix(col, col * vec3(1.2, 1.1, 0.6), tipYellow * 0.4);
      }

      // Noise-based patchy variation (clumps of slightly different color)
      float patchNoise = texture(uNoiseTexture, vWorldPos * 0.02).r;
      col *= 0.92 + patchNoise * 0.16;

      // Apply GI light (modulates the base color)
      // Base ambient is low when GI is enabled (grass relies on GI for brightness)
      if (uGIEnabled > 0.5) {
        float baseAmbient = 0.15; // Low ambient when GI is active
        col *= baseAmbient + vGILight * 0.85;
      }

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
