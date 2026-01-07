/**
 * BladeGrassShader.ts
 *
 * High-quality grass rendering using thin curved blades.
 * Single draw call per chunk using InstancedBufferGeometry with:
 * - Per-instance position, rotation, scale, type attributes
 * - Bezier-curved blade geometry for natural look
 * - Efficient wind animation in vertex shader
 * - Root shadowing for grounded appearance
 *
 * References:
 * - https://al-ro.github.io/projects/grass/
 * - https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/
 */

import * as THREE from 'three';

// Configuration
export const BLADE_GRASS_CONFIG = {
  // Instance count per chunk (single draw call)
  // 20000 instances = dense grass coverage
  INSTANCES_PER_CHUNK: 20000,

  // Blade geometry
  BLADE_WIDTH: 0.05,
  BLADE_HEIGHT: 0.4,
  BLADE_JOINTS: 4, // Vertices along blade height for curvature

  // LOD scaling
  LOD_INSTANCE_COUNTS: [20000, 8000, 2000, 0] as const, // LOD 0, 1, 2, 3+

  // Biome grass density multipliers
  BIOME_DENSITY: {
    PLAINS: 1.0,
    THE_GROVE: 1.2,
    JUNGLE: 0.6, // Less grass, more ferns in component
    MOUNTAINS: 0.4,
    SAVANNA: 0.9,
    SKY_ISLANDS: 0.8,
  } as const,
};

/**
 * Create a single grass blade geometry with curved shape.
 * Uses PlaneGeometry subdivided vertically, with curvature baked in.
 */
export function createBladeGeometry(
  width = BLADE_GRASS_CONFIG.BLADE_WIDTH,
  height = BLADE_GRASS_CONFIG.BLADE_HEIGHT,
  joints = BLADE_GRASS_CONFIG.BLADE_JOINTS
): THREE.BufferGeometry {
  // Create subdivided plane (1 segment wide, joints segments tall)
  const geo = new THREE.PlaneGeometry(width, height, 1, joints);

  // Get position attribute to modify
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  // Apply curvature: bend blade backwards as it goes up
  // Also taper width towards tip
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);

    // Normalized height (0 at base, 1 at tip)
    const t = (y + height / 2) / height;

    // Taper width: full at base, pointed at tip
    const taper = 1.0 - t * t * 0.9; // Quadratic taper
    pos.setX(i, x * taper);

    // Add slight random curvature (baked into geometry)
    // Actual per-instance curvature handled in shader
    const curve = t * t * 0.05; // Slight backward lean
    pos.setZ(i, curve);

    // Store height fraction in UV.y for shader use
    // UV.x stays for potential texture mapping
    uv.setY(i, t);
  }

  // Translate so base is at origin (grass grows up from placement point)
  geo.translate(0, height / 2, 0);

  geo.computeVertexNormals();

  return geo;
}

/**
 * Vertex shader for blade grass.
 * Handles:
 * - Per-instance positioning from terrain textures
 * - Per-instance rotation, scale, curvature
 * - Wind animation with gusts
 * - Surface normal alignment
 */
export const BLADE_GRASS_VERTEX = /* glsl */ `
  // Terrain data textures (32x32)
  uniform sampler2D uHeightMap;
  uniform sampler2D uMaterialMask;
  uniform sampler2D uNormalMap;
  uniform sampler2D uBiomeMap;
  uniform sampler2D uCaveMask;

  // GI light grid (8x32x8)
  uniform sampler3D uLightGrid;

  // Animation and positioning
  uniform float uTime;
  uniform vec2 uWindDir;
  uniform vec3 uChunkOffset;
  uniform float uInstanceCount;

  // GI settings
  uniform float uGIEnabled;
  uniform float uGIIntensity;

  // Noise for variation
  uniform sampler3D uNoiseTexture;

  // Varyings to fragment
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vHeightFraction;
  varying vec3 vGILight;
  varying float vBiomeId;
  varying float vVisible;

  // Hash functions for deterministic randomness
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec2 hash2(vec2 p) {
    return fract(sin(vec2(
      dot(p, vec2(127.1, 311.7)),
      dot(p, vec2(269.5, 183.3))
    )) * 43758.5453);
  }

  vec3 hash3(vec2 p) {
    return fract(sin(vec3(
      dot(p, vec2(127.1, 311.7)),
      dot(p, vec2(269.5, 183.3)),
      dot(p, vec2(419.2, 371.9))
    )) * 43758.5453);
  }

  // Rodrigues rotation formula for rotating vector around axis
  vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  void main() {
    vUv = uv;
    vHeightFraction = uv.y; // Stored in UV during geometry creation

    // Decode instance position from instance ID
    // Scatter instances across 32x32 chunk area
    float id = float(gl_InstanceID);

    // Use golden ratio for better distribution
    float phi = 1.61803398875;
    float theta = id * phi * 6.28318530718;
    float radius = sqrt(id / uInstanceCount) * 16.0; // Radius 0-16

    // Convert to chunk coordinates (0-32)
    float chunkX = 16.0 + cos(theta) * radius;
    float chunkZ = 16.0 + sin(theta) * radius;

    // Add jitter based on instance ID
    vec2 cellId = vec2(id, id * 1.7);
    vec2 jitter = hash2(cellId) - 0.5;
    chunkX += jitter.x * 1.0;
    chunkZ += jitter.y * 1.0;

    // Clamp to chunk bounds
    chunkX = clamp(chunkX, 0.5, 31.5);
    chunkZ = clamp(chunkZ, 0.5, 31.5);

    // UV for texture sampling
    vec2 texUV = vec2(chunkX, chunkZ) / 32.0;

    // Sample terrain textures
    float surfaceY = texture2D(uHeightMap, texUV).r;
    float matMask = texture2D(uMaterialMask, texUV).r;
    vec2 packedNormal = texture2D(uNormalMap, texUV).rg;
    float biomeId = texture2D(uBiomeMap, texUV).r * 255.0;
    float caveMask = texture2D(uCaveMask, texUV).r;

    vBiomeId = biomeId;

    // === Visibility Checks ===
    float visible = 1.0;

    // Material mask (grass-friendly surface)
    visible *= step(0.5, matMask);

    // Cave mask (not over cave opening)
    visible *= step(0.5, caveMask);

    // Valid height (not air column)
    visible *= step(-900.0, surfaceY);

    // Above water level
    visible *= step(5.0, surfaceY);

    // Biome check (no grass in desert, snow, ice, beach)
    float badBiome = step(1.5, biomeId) * step(biomeId, 3.5); // Desert
    badBiome += step(4.5, biomeId) * step(biomeId, 6.5);      // Snow/Ice
    badBiome += step(7.5, biomeId) * step(biomeId, 8.5);      // Beach
    visible *= 1.0 - badBiome;

    vVisible = visible;

    // Early exit for invisible blades
    if (visible < 0.5) {
      csm_Position = vec3(0.0, -9999.0, 0.0);
      return;
    }

    // === Instance Variation ===
    vec3 rands = hash3(cellId);
    float randScale = 0.6 + rands.x * 0.8;   // Scale: 0.6 - 1.4
    float randRot = rands.y * 6.28318;       // Rotation: 0 - 2π
    float randCurve = rands.z * 0.3 + 0.1;   // Curvature: 0.1 - 0.4

    // Biome-specific height adjustments
    if (biomeId > 8.5 && biomeId < 9.5) {
      // Savanna: taller grass
      randScale *= 1.4;
    } else if (biomeId > 6.5 && biomeId < 7.5) {
      // Mountains: shorter, hardier grass
      randScale *= 0.7;
    }

    // === Unpack Surface Normal ===
    vec3 surfaceNormal;
    surfaceNormal.x = packedNormal.r * 2.0 - 1.0;
    surfaceNormal.z = packedNormal.g * 2.0 - 1.0;
    float xzSq = surfaceNormal.x * surfaceNormal.x + surfaceNormal.z * surfaceNormal.z;
    surfaceNormal.y = sqrt(max(0.0, 1.0 - xzSq));

    // === Build Position ===
    vec3 basePos = vec3(chunkX, surfaceY, chunkZ);

    // Slope compensation
    float slopeSink = (1.0 - surfaceNormal.y) * 0.5;
    basePos.y -= slopeSink;

    // === Transform Blade ===
    vec3 pos = position;

    // Scale blade
    pos.y *= randScale;
    pos.x *= (0.8 + rands.x * 0.4); // Width variation

    // Apply curvature based on height
    float t = vHeightFraction;
    float curveAmount = t * t * randCurve;
    pos.z += curveAmount * randScale * 0.5;

    // Rotate around Y axis
    float c = cos(randRot);
    float s = sin(randRot);
    pos.xz = vec2(c * pos.x - s * pos.z, s * pos.x + c * pos.z);

    // === Wind Animation ===
    vec3 worldPosBase = basePos + uChunkOffset;

    // Multi-frequency wind
    float windTime = uTime * 1.2;
    float windPhase = worldPosBase.x * 0.15 + worldPosBase.z * 0.1;

    // Primary sway
    float wind1 = sin(windTime + windPhase) * 0.7;
    // Secondary faster oscillation
    float wind2 = sin(windTime * 2.3 + windPhase * 1.5) * 0.3;
    // Gusts (slower, larger movements)
    float gust = sin(windTime * 0.4 - windPhase * 0.5) * 0.5;

    float windTotal = wind1 + wind2 + gust;

    // Wind affects upper parts more (quadratic falloff from base)
    float windMask = t * t;
    float windStrength = windMask * 0.15 * randScale;

    // Apply wind as rotation around base
    pos.x += windTotal * windStrength * uWindDir.x;
    pos.z += windTotal * windStrength * uWindDir.y;

    // Slight vertical compression during strong wind
    pos.y -= abs(windTotal) * windMask * 0.02;

    // === Align to Surface Normal ===
    vec3 up = surfaceNormal;
    vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), up));
    if (length(right) < 0.01) right = vec3(1.0, 0.0, 0.0);
    vec3 forward = cross(up, right);
    mat3 alignMat = mat3(right, up, forward);

    pos = alignMat * pos;

    // === Final Position ===
    vec3 localPos = basePos + pos;
    vWorldPos = localPos + uChunkOffset;

    // === Sample GI Light ===
    float lightCellSize = 4.0;
    float lightGridXZ = 8.0;
    float lightGridY = 32.0;

    vec3 lightUV = vec3(
      chunkX / lightCellSize / lightGridXZ,
      (surfaceY + 35.0) / lightCellSize / lightGridY,
      chunkZ / lightCellSize / lightGridXZ
    );
    lightUV = clamp(lightUV, 0.0, 1.0);

    if (uGIEnabled > 0.5) {
      vec4 lightSample = texture(uLightGrid, lightUV);
      vGILight = lightSample.rgb * uGIIntensity;
    } else {
      vGILight = vec3(1.0);
    }

    csm_Position = localPos;
  }
`;

/**
 * Fragment shader for blade grass.
 * Handles:
 * - Root shadowing (AO)
 * - Biome color tinting
 * - Tip brightening
 * - Subsurface scattering approximation
 * - Distance fog
 */
export const BLADE_GRASS_FRAGMENT = /* glsl */ `
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
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vHeightFraction;
  varying vec3 vGILight;
  varying float vBiomeId;
  varying float vVisible;

  vec3 getBiomeTint(float biomeId) {
    // JUNGLE: Deep saturated green
    if (biomeId > 3.5 && biomeId < 4.5) return vec3(0.8, 1.0, 0.7);
    // SAVANNA: Warm golden
    if (biomeId > 8.5 && biomeId < 9.5) return vec3(1.2, 1.1, 0.65);
    // MOUNTAINS: Cool blue-green
    if (biomeId > 6.5 && biomeId < 7.5) return vec3(0.9, 0.95, 1.0);
    // THE_GROVE: Lush vibrant
    if (biomeId > 0.5 && biomeId < 1.5) return vec3(0.85, 1.1, 0.8);
    // SKY_ISLANDS: Ethereal mint
    if (biomeId > 9.5) return vec3(0.92, 1.12, 1.0);
    return vec3(1.0);
  }

  void main() {
    if (vVisible < 0.5) discard;

    float t = vHeightFraction;

    // === Base Color with Gradient ===
    vec3 baseCol = uBaseColor;
    vec3 tipCol = uTipColor;
    vec3 col = mix(baseCol, tipCol, t);

    // === Biome Tinting ===
    col *= getBiomeTint(vBiomeId);

    // === Noise-based Variation ===
    vec3 noiseCoord = vWorldPos * 0.06;
    float noise = texture(uNoiseTexture, noiseCoord).r;
    float noise2 = texture(uNoiseTexture, noiseCoord * 2.0).g;

    // Color patches
    col *= 0.9 + noise * 0.2;

    // Warm/cool micro-variation
    vec3 warmShift = vec3(1.03, 1.0, 0.95);
    vec3 coolShift = vec3(0.95, 1.0, 1.03);
    col = mix(col * coolShift, col * warmShift, noise2);

    // === Root Shadowing (Ambient Occlusion) ===
    // Subtle darkening at base - less aggressive for natural look
    float ao = smoothstep(0.0, 0.3, t);
    col *= mix(0.7, 1.0, ao); // 70% brightness at base, 100% at top

    // === GI Light ===
    // Grass should always be bright - GI adds variation but never makes it too dark
    if (uGIEnabled > 0.5) {
      // Boost dark GI values to prevent black grass
      vec3 boostedGI = max(vGILight, vec3(0.5)); // Floor at 50% brightness
      col *= 0.4 + boostedGI * 0.6; // 40% base + 60% GI contribution
    }

    // === Subsurface Scattering ===
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float sss = pow(max(0.0, dot(-viewDir, uSunDir)), 4.0);
    sss *= t; // More translucency at tips
    col += tipCol * sss * 0.25;

    // === Rim Lighting ===
    // Note: vNormal is provided by CustomShaderMaterial, use it directly
    vec3 N = normalize(vNormal);
    float rim = 1.0 - max(0.0, dot(viewDir, N));
    rim = pow(rim, 3.0) * t;
    col += tipCol * rim * 0.15;

    // === Distance Fog ===
    float fogDist = length(vWorldPos - cameraPosition);
    float fogRange = max(uFogFar - uFogNear, 1.0);
    float density = 3.0 / fogRange;
    float distFactor = max(0.0, fogDist - uFogNear);
    float fogAmt = 1.0 - exp(-pow(distFactor * density, 2.0));

    // Height fog
    if (uHeightFogEnabled > 0.5) {
      float heightFactor = smoothstep(
        uHeightFogOffset + uHeightFogRange,
        uHeightFogOffset,
        vWorldPos.y
      );
      float hDistFactor = smoothstep(5.0, 25.0, fogDist);
      float heightFog = heightFactor * uHeightFogStrength * hDistFactor;
      fogAmt = clamp(fogAmt + heightFog, 0.0, 1.0);
    }

    col = mix(col, uFogColor, fogAmt * uShaderFogStrength);

    csm_DiffuseColor = vec4(col, 1.0);
  }
`;
