import { makeNoise2D } from 'fast-simplex-noise';
import { MaterialType } from '@/types';
import { WATER_LEVEL } from '@/constants';

export type BiomeType =
  | 'PLAINS'
  | 'DESERT'
  | 'SNOW'
  | 'MOUNTAINS'
  | 'JUNGLE'
  | 'SAVANNA'
  | 'ICE_SPIKES'
  | 'RED_DESERT'
  | 'BEACH'
  | 'SKY_ISLANDS' // Special case
  | 'THE_GROVE'; // Default/Temperate

export enum WorldType {
  DEFAULT = 'DEFAULT',
  SKY_ISLANDS = 'SKY_ISLANDS',
  FROZEN = 'FROZEN',
  LUSH = 'LUSH',
  CHAOS = 'CHAOS'
}


export interface BiomeCaveSettings {
  scale: number;      // How "zoomed out" the noise is (lower = bigger caves)
  threshold: number;  // Cavity thickness (higher = wider tunnels)
  frequency: number;  // Wiggle factor (higher = more twisted)
  surfaceBreachChance: number; // 0..1 chance of caves breaking surface (modulated by noise)
}

/**
 * Fog settings per biome for atmospheric rendering.
 * These create distinct visual identities for different environments.
 */
export interface BiomeFogSettings {
  /** Density multiplier (0.5 = half fog, 2.0 = double). Higher humidity = more fog. */
  densityMul: number;
  /** Height fog multiplier. Jungles pool fog in valleys, mountains have clear air. */
  heightFogMul: number;
  /** RGB tint added to fog color (normalized -0.2 to 0.2). Desert = warm, snow = cool. */
  tintR: number;
  tintG: number;
  tintB: number;
  /** How much fog absorbs color saturation at distance (0 = none, 1 = full desaturation). */
  aerialPerspective: number;
}

export const BIOME_CAVE_SETTINGS: Record<string, BiomeCaveSettings> = {
  // Archetypes
  GRASSLANDS: { scale: 0.035, threshold: 0.15, frequency: 1.0, surfaceBreachChance: 0.25 }, // Wider, more breaches
  // DESERT archetype removed to avoid duplicate key error. Using specific mapping below.
  TUNDRA: { scale: 0.05, threshold: 0.10, frequency: 2.0, surfaceBreachChance: 0.3 }, // Slightly wider
  LUMINA: { scale: 0.025, threshold: 0.22, frequency: 0.8, surfaceBreachChance: 0.4 }, // Huge hollows

  // Specific Biome Mappings
  PLAINS: { scale: 0.035, threshold: 0.15, frequency: 1.0, surfaceBreachChance: 0.15 }, // Safer but still has caves
  THE_GROVE: { scale: 0.035, threshold: 0.15, frequency: 1.0, surfaceBreachChance: 0.25 },
  SAVANNA: { scale: 0.035, threshold: 0.15, frequency: 1.0, surfaceBreachChance: 0.3 },
  JUNGLE: { scale: 0.035, threshold: 0.15, frequency: 1.0, surfaceBreachChance: 0.35 },
  // BEACH: Similar to PLAINS, but slightly lower breach chance to keep shorelines cleaner.
  BEACH: { scale: 0.035, threshold: 0.15, frequency: 1.0, surfaceBreachChance: 0.12 },

  DESERT: { scale: 0.02, threshold: 0.16, frequency: 0.5, surfaceBreachChance: 0.25 },
  RED_DESERT: { scale: 0.02, threshold: 0.16, frequency: 0.5, surfaceBreachChance: 0.25 },

  SNOW: { scale: 0.05, threshold: 0.10, frequency: 2.0, surfaceBreachChance: 0.3 },
  ICE_SPIKES: { scale: 0.05, threshold: 0.10, frequency: 2.0, surfaceBreachChance: 0.4 },
  MOUNTAINS: { scale: 0.05, threshold: 0.10, frequency: 2.0, surfaceBreachChance: 0.8 }, // Very high chance on mountains

  SKY_ISLANDS: { scale: 0.015, threshold: 0.00, frequency: 1.0, surfaceBreachChance: 0.0 }, // No caves by default (threshold 0)

  // Fallback
  DEFAULT: { scale: 0.035, threshold: 0.15, frequency: 1.0, surfaceBreachChance: 0.25 }
};

export function getCaveSettings(biomeId: string): BiomeCaveSettings {
  return BIOME_CAVE_SETTINGS[biomeId] || BIOME_CAVE_SETTINGS.DEFAULT;
}

/**
 * Biome-specific fog settings for atmospheric rendering.
 * Each biome has distinct fog characteristics that enhance its identity.
 */
export const BIOME_FOG_SETTINGS: Record<string, BiomeFogSettings> = {
  // --- Arid Biomes (Low humidity = distant haze, warm tint) ---
  DESERT: {
    densityMul: 0.6,        // Less fog overall
    heightFogMul: 0.3,      // Minimal ground fog
    tintR: 0.08, tintG: 0.04, tintB: -0.04,  // Warm sandy haze
    aerialPerspective: 0.7  // Strong desaturation at distance
  },
  RED_DESERT: {
    densityMul: 0.7,
    heightFogMul: 0.4,
    tintR: 0.12, tintG: 0.02, tintB: -0.06,  // Reddish dust
    aerialPerspective: 0.75
  },
  SAVANNA: {
    densityMul: 0.8,
    heightFogMul: 0.5,
    tintR: 0.06, tintG: 0.04, tintB: -0.02,  // Subtle warm
    aerialPerspective: 0.5
  },

  // --- Humid Biomes (High humidity = thick mist, lush tint) ---
  JUNGLE: {
    densityMul: 1.4,        // Thick jungle mist
    heightFogMul: 1.6,      // Heavy ground fog pooling
    tintR: -0.02, tintG: 0.04, tintB: 0.0,   // Slight green tint
    aerialPerspective: 0.3  // Maintains color vibrancy
  },
  THE_GROVE: {
    densityMul: 0.7,        // Less fog - let the green show through
    heightFogMul: 0.8,      // Light morning mist, not heavy fog
    tintR: -0.04, tintG: 0.08, tintB: -0.06, // Strong green shift, remove blue
    aerialPerspective: 0.25 // Maintain color vibrancy at distance
  },

  // --- Cold Biomes (Crisp air, blue tint) ---
  SNOW: {
    densityMul: 0.7,        // Clear cold air
    heightFogMul: 0.8,
    tintR: -0.04, tintG: -0.02, tintB: 0.06, // Blue-white
    aerialPerspective: 0.6
  },
  ICE_SPIKES: {
    densityMul: 0.5,        // Very clear
    heightFogMul: 0.6,
    tintR: -0.06, tintG: 0.0, tintB: 0.1,    // Icy blue
    aerialPerspective: 0.65
  },

  // --- Mountain Biomes (Very clear, slight blue) ---
  MOUNTAINS: {
    densityMul: 0.4,        // Crystal clear mountain air
    heightFogMul: 0.3,      // Minimal ground fog at elevation
    tintR: -0.02, tintG: 0.0, tintB: 0.04,   // Slight atmospheric blue
    aerialPerspective: 0.8  // Strong aerial perspective (distant peaks fade)
  },

  // --- Neutral Biomes ---
  PLAINS: {
    densityMul: 1.0,
    heightFogMul: 1.0,
    tintR: 0.0, tintG: 0.0, tintB: 0.0,
    aerialPerspective: 0.45
  },
  BEACH: {
    densityMul: 1.1,        // Sea mist
    heightFogMul: 1.3,      // Pools near water
    tintR: 0.02, tintG: 0.02, tintB: 0.04,   // Salty blue
    aerialPerspective: 0.4
  },

  // --- Special ---
  SKY_ISLANDS: {
    densityMul: 1.2,
    heightFogMul: 2.0,      // Heavy cloud banks below islands
    tintR: 0.0, tintG: 0.0, tintB: 0.02,
    aerialPerspective: 0.35
  },

  // Default fallback
  DEFAULT: {
    densityMul: 1.0,
    heightFogMul: 1.0,
    tintR: 0.0, tintG: 0.0, tintB: 0.0,
    aerialPerspective: 0.45
  }
};

export function getFogSettings(biomeId: string): BiomeFogSettings {
  return BIOME_FOG_SETTINGS[biomeId] || BIOME_FOG_SETTINGS.DEFAULT;
}

// Helper function for linear interpolation
const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;

// Helper to smooth the noise input (removes harsh linearity)
const smooth = (t: number) => t * t * (3 - 2 * t);

export class BiomeManager {
  // World seed - configurable for different world generation
  private static seed = 1337;
  private static currentWorldType: WorldType = WorldType.DEFAULT;

  /**
   * Get the current seed value.
   */
  static getSeed(): number {
    return this.seed;
  }

  /**
   * Reinitialize all noise generators with a new seed.
   * Call this when starting a new world or changing seeds.
   *
   * @param newSeed - The new seed value (positive integer)
   */
  static reinitialize(newSeed: number): void {
    const normalizedSeed = Math.abs(Math.floor(newSeed)) || 1;

    if (this.seed === normalizedSeed) {
      // console.log('[BiomeManager] Seed unchanged, skipping reinitialization');
      return;
    }

    this.seed = normalizedSeed;

    // Recreate all noise functions with the new seed
    this.tempNoise = makeNoise2D(() => this.hash(this.seed + 1));
    this.humidNoise = makeNoise2D(() => this.hash(this.seed + 2));
    this.continentalNoise = makeNoise2D(() => this.hash(this.seed + 3));
    this.erosionNoise = makeNoise2D(() => this.hash(this.seed + 4));
    this.sacredGroveNoise = makeNoise2D(() => this.hash(this.seed + 5));

    // console.log(`[BiomeManager] Reinitialized with seed: ${this.seed}`);
  }

  static setWorldType(type: WorldType) {
    if (this.currentWorldType === type) return; // Avoid duplicate calls from StrictMode
    this.currentWorldType = type;
    // console.log('[BiomeManager] World Type set to:', type);
  }

  /**
   * Get the current world type.
   */
  static getWorldType(): WorldType {
    return this.currentWorldType;
  }

  // 2D Noise functions for macro-climate
  private static tempNoise = makeNoise2D(() => this.hash(this.seed + 1));
  private static humidNoise = makeNoise2D(() => this.hash(this.seed + 2));

  // Physical Reality noise layers
  // ContinentalNoise: Low frequency, defines Ocean vs Land.
  private static continentalNoise = makeNoise2D(() => this.hash(this.seed + 3));
  // ErosionNoise: Defines "Flatness" vs "Mountainous".
  private static erosionNoise = makeNoise2D(() => this.hash(this.seed + 4));
  // SacredGroveNoise: Creates isolated pocket clearings for Root Hollows
  private static sacredGroveNoise = makeNoise2D(() => this.hash(this.seed + 5));

  // Scales - Adjusted for larger, more realistic features
  static readonly TEMP_SCALE = 0.0008; // (Was 0.0013)
  static readonly HUMID_SCALE = 0.0008;
  static readonly CONT_SCALE = 0.0005; // Continents are huge
  static readonly EROSION_SCALE = 0.001; // Mountain ranges are large
  static readonly LATITUDE_SCALE = 0.0002; // 1 unit temp change every 5000 blocks
  // Sacred Grove noise scale: lower = larger clearings, more spaced out
  // 0.008 creates ~125 block wavelength features (substantial clearings)
  static readonly SACRED_GROVE_SCALE = 0.008;
  static readonly SACRED_GROVE_RADIUS = 32; // Radius of barren zone around Root Hollow center

  // Simple pseudo-random for seeding
  private static hash(n: number): number {
    n = Math.sin(n) * 43758.5453123;
    return n - Math.floor(n);
  }

  // --- 1. Biome Classification ---

  /**
   * Returns full climate data including Temperature, Humidity, Continentalness, and Erosion.
   * - temp/humid: -1..1
   * - continent: -1 (Deep Ocean) .. 1 (Inland)
   * - erosion: -1 (Flat) .. 1 (Peaky/Mountainous)
   */
  static getClimate(x: number, z: number): { temp: number, humid: number, continent: number, erosion: number } {
    // 1. Temperature Gradient (Latitude)
    const latitude = -z * this.LATITUDE_SCALE;
    let baseTemp = latitude;

    // 2. Add Noise Variation
    let noiseTemp = this.tempNoise(x * this.TEMP_SCALE, z * this.TEMP_SCALE);
    let humid = this.humidNoise(x * this.HUMID_SCALE, z * this.HUMID_SCALE);

    // --- STRATEGY OVERRIDES ---
    switch (this.currentWorldType) {
      case WorldType.FROZEN:
        // Force cold: -1.0 to -0.2 (never hot)
        baseTemp = -0.6;
        noiseTemp = noiseTemp * 0.4; // Low variance
        break;

      case WorldType.LUSH:
        // Force temperate/hot: 0.0 to 0.8
        baseTemp = 0.4;
        noiseTemp = noiseTemp * 0.4;
        // Bias humidity to be Wet
        humid = Math.max(-0.2, humid + 0.4);
        break;

      case WorldType.CHAOS:
        // Extreme noise scales
        noiseTemp = this.tempNoise(x * this.TEMP_SCALE * 10, z * this.TEMP_SCALE * 10);
        humid = this.humidNoise(x * this.HUMID_SCALE * 10, z * this.HUMID_SCALE * 10);
        baseTemp = 0; // No latitude
        break;

      case WorldType.SKY_ISLANDS:
      case WorldType.DEFAULT:
      default:
        // Existing logic (Latitude + Noise)
        break;
    }

    // Mix: 70% Base, 30% Noise (Adjusted for chaos)
    let temp = baseTemp * 0.7 + noiseTemp * 0.3;

    if (this.currentWorldType === WorldType.CHAOS) {
      temp = noiseTemp; // Pure noise for chaos
    }

    // Clamp to -1..1
    if (temp > 1.0) temp = 1.0;
    if (temp < -1.0) temp = -1.0;

    // Continentalness & Erosion
    let continent = this.continentalNoise(x * this.CONT_SCALE, z * this.CONT_SCALE);
    let erosion = this.erosionNoise(x * this.EROSION_SCALE, z * this.EROSION_SCALE);

    return { temp, humid, continent, erosion };
  }

  /**
   * Get humidity field value at world position.
   * Combines biome climate humidity with water proximity.
   *
   * @param worldX - World X coordinate
   * @param worldY - World Y coordinate (height matters for water proximity)
   * @param worldZ - World Z coordinate
   * @returns Humidity value 0-1 (0 = arid, 1 = saturated)
   */
  static getHumidityField(worldX: number, worldY: number, worldZ: number): number {
    // Check Sacred Grove FIRST - barren zones are completely arid until tree grows
    // Tree humidity spreading is handled separately via treeHumidityBoost vertex attribute
    const groveInfo = this.getSacredGroveInfo(worldX, worldZ);
    if (groveInfo.inGrove && groveInfo.intensity > 0.3) {
      // Sacred Grove centers are bone dry - no water influence, no climate humidity
      // This overrides everything including water proximity
      return 0.0;
    }

    // 1. Get base climate humidity (already exists, -1 to 1 range)
    const climate = this.getClimate(worldX, worldZ);
    const baseHumid = (climate.humid + 1) * 0.5; // Normalize to 0-1

    // 2. Water proximity boost - closer to water level = more humid
    const waterDist = Math.abs(worldY - WATER_LEVEL);
    const waterInfluence = Math.max(0, 1 - waterDist / 24); // Full influence within 24 blocks

    // 3. Below water = fully saturated
    if (worldY < WATER_LEVEL) return 1.0;

    // 4. Combine: 70% biome base + 30% water proximity
    let humidity = Math.min(1, baseHumid * 0.7 + waterInfluence * 0.3);

    // 5. Fade humidity at Sacred Grove edges (intensity 0-0.3)
    if (groveInfo.inGrove) {
      // Smooth transition at edges
      const edgeFade = groveInfo.intensity / 0.3; // 0 at edge, 1 at intensity=0.3
      humidity *= (1.0 - edgeFade);
    }

    return humidity;
  }

  static getBiomeAt(x: number, z: number): BiomeType {
    const { temp, humid, continent, erosion } = this.getClimate(x, z);
    return this.getBiomeFromMetrics(temp, humid, continent, erosion);
  }

  /**
   * Applies temperature/humidity biomes, then intercepts special cases that depend on
   * physical metrics (continentalness/erosion) or world type.
   *
   * Note: TerrainService uses this variant so it can keep its existing Y-dithered temp/humid
   * while still producing consistent coastlines from column-constant continent/erosion.
   */
  static getBiomeFromMetrics(temp: number, humid: number, continent: number, erosion: number): BiomeType {
    if (this.currentWorldType === WorldType.SKY_ISLANDS) {
      return 'SKY_ISLANDS';
    }

    // Base biomes are determined from temperature/humidity, then we optionally intercept
    // "special" regions (like coasts) using physical reality metrics.
    const baseBiome = this.getBiomeFromClimate(temp, humid);

    // --- Coastal Beach Biome ---
    // Continentalness pivots at 0.1 in getTerrainParametersFromMetrics:
    // - continent < -0.3: deep ocean
    // - -0.3..0.1: coast transition
    // - 0.1..1.0: land
    //
    // Beaches should appear in the coast-transition band (plus a small inland buffer),
    // and only when erosion indicates relatively flat terrain (otherwise you get cliffs).
    //
    // IMPORTANT: The lower bound must include the ocean-side of the transition (-0.3..),
    // otherwise the shoreline can end up with no sand at all.
    const isCoastal = continent > -0.25 && continent < 0.20;
    const erosion01 = (erosion + 1) / 2; // -1..1 -> 0..1
    const isFlat = erosion01 < 0.50;
    const isNotFrozen = baseBiome !== 'SNOW' && baseBiome !== 'ICE_SPIKES';

    if (isCoastal && isFlat && isNotFrozen) {
      return 'BEACH';
    }
    // --------------------------

    // --- Mountain Biome ---
    // High erosion indicates rugged, mountainous terrain.
    // Use the same erosion01 threshold (0.75) that already boosts terrain amplitude.
    // Must not override BEACH (coastal takes priority) or frozen biomes (keeps ICE_SPIKES).
    const isMountainous = erosion01 > 0.75;
    const isNotCoastal = !isCoastal;
    const isNotFrozenBiome = baseBiome !== 'ICE_SPIKES'; // Allow SNOW->MOUNTAINS, keep ICE_SPIKES distinct

    if (isMountainous && isNotCoastal && isNotFrozenBiome) {
      return 'MOUNTAINS';
    }
    // ----------------------

    return baseBiome;
  }

  static getBiomeFromClimate(temp: number, humid: number): BiomeType {
    // Discrete Biome Logic (for Material Selection mainly)
    if (temp < -0.5) { // Cold
      if (humid > 0.5) return 'ICE_SPIKES';
      if (humid < -0.5) return 'SNOW'; // Frozen Wasteland
      return 'SNOW'; // Snowy Taiga
    } else if (temp > 0.5) { // Hot
      if (humid > 0.5) return 'JUNGLE';
      if (humid < -0.5) return 'RED_DESERT';
      return 'SAVANNA';
    } else { // Temperate
      if (humid > 0.5) return 'JUNGLE'; // Swamp/Dense Forest
      if (humid < -0.5) return 'PLAINS';
      return 'THE_GROVE';
    }
  }

  // --- 2. Surface Material Lookup ---

  static getSurfaceMaterial(biome: BiomeType): MaterialType {
    switch (biome) {
      case 'BEACH': return MaterialType.SAND;
      case 'DESERT': return MaterialType.SAND;
      case 'RED_DESERT': return MaterialType.RED_SAND;
      case 'SNOW': return MaterialType.SNOW;
      case 'ICE_SPIKES': return MaterialType.ICE;
      case 'JUNGLE': return MaterialType.JUNGLE_GRASS;
      case 'SAVANNA': return MaterialType.DIRT;
      case 'MOUNTAINS': return MaterialType.STONE;
      case 'PLAINS': return MaterialType.GRASS;
      case 'THE_GROVE': return MaterialType.GRASS;
      case 'SKY_ISLANDS': return MaterialType.GRASS;
      default: return MaterialType.GRASS;
    }
  }

  // --- 2.5 Underground Material Lookup ---

  static getUndergroundMaterials(biome: BiomeType): { primary: MaterialType, secondary: MaterialType } {
    switch (biome) {
      case 'BEACH':
        // Common shoreline profile: sand on top with stone underneath.
        return { primary: MaterialType.STONE, secondary: MaterialType.SAND };
      case 'DESERT':
      case 'SAVANNA':
        return { primary: MaterialType.TERRACOTTA, secondary: MaterialType.SAND };
      case 'RED_DESERT':
        return { primary: MaterialType.TERRACOTTA, secondary: MaterialType.RED_SAND };
      case 'JUNGLE':
        return { primary: MaterialType.MOSSY_STONE, secondary: MaterialType.STONE };
      case 'SNOW':
        return { primary: MaterialType.STONE, secondary: MaterialType.ICE };
      case 'ICE_SPIKES':
        return { primary: MaterialType.ICE, secondary: MaterialType.SNOW };
      case 'MOUNTAINS':
        return { primary: MaterialType.STONE, secondary: MaterialType.STONE };
      default:
        // THE_GROVE, PLAINS, Default
        return { primary: MaterialType.STONE, secondary: MaterialType.DIRT };
    }
  }

  // --- 3. Height/Terrain Parameter Blending ---

  /**
   * Returns terrain shaping parameters interpolated based on climate.
   * TerrainService can use these to calculate density/height.
   */
  static getTerrainParameters(x: number, z: number): {
    baseHeight: number,
    amp: number,
    freq: number,
    warp: number
  } {
    const { temp, humid, continent, erosion } = this.getClimate(x, z);
    return this.getTerrainParametersFromMetrics(temp, humid, continent, erosion);
  }

  static getTerrainParametersFromMetrics(temp: number, humid: number, continent: number, erosion: number): {
    baseHeight: number,
    amp: number,
    freq: number,
    warp: number
  } {
    // 1. Get Base Biome Params (Temperature/Humidity based)
    const params = this.getTerrainParametersFromClimate(temp, humid);

    // 2. Apply "Physical Reality" Logic (Continentalness & Erosion)

    // CONTINENTALNESS:
    // Controls the "Base Height" of the world.
    // -1.0 to -0.3: Deep Ocean
    // -0.3 to  0.1: Coast / Transition
    //  0.1 to  1.0: Land

    let heightMod = 0;

    if (continent < -0.3) {
      // Ocean
      // Drop height significantly to create water bodies
      // Smooth transition at the edge
      const depth = -continent; // 0.3 to 1.0
      heightMod = -30 * (depth + 0.5); // -24 to -45
      params.amp *= 0.3; // Flatter ocean floor
    } else if (continent < 0.1) {
      // Coast Transition
      // continent is -0.3 to 0.1 (range 0.4)
      // t go form 0 (ocean side) to 1 (land side)
      const t = (continent - (-0.3)) / 0.4;
      // Lerp from Ocean floor (-20) to Land (0)
      heightMod = lerp(-20, 0, t);
      params.amp *= lerp(0.3, 1.0, t);
    } else {
      // Land
      // continent 0.1 to 1.0
      // Slight rise inland
      heightMod = (continent - 0.1) * 10;
    }
    params.baseHeight += heightMod;

    // EROSION:
    // Controls the "Ruggedness" (Amplitude) and "Feature Type".
    // -1 (Sediment/Flat) -> 1 (Eroded Peaks)

    const e = (erosion + 1) / 2; // 0..1

    if (e < 0.3) {
      // Flatlands / Plains
      params.amp *= 0.5;
      params.warp *= 0.5;
    } else if (e > 0.7) {
      // Mountains
      // Boost amplitude significantly
      // e goes 0.7 -> 1.0
      const mountainFactor = (e - 0.7) / 0.3; // 0..1
      // Keep peaks within the single-vertical-chunk world budget; extreme values can
      // push the surface above `CHUNK_SIZE_Y` and cause entire columns to be solid.
      params.amp *= (1.0 + mountainFactor * 0.6); // Up to 1.6x amp
      params.baseHeight += mountainFactor * 6; // Gentle lift
      params.warp *= 1.2;
    }

    return params;
  }

  static getTerrainParametersFromClimate(temp: number, humid: number): {
    baseHeight: number,
    amp: number,
    freq: number,
    warp: number
  } {
    // 2. Normalize to 0..1 range for easier math
    const t = smooth((temp + 1) / 2); // 0 = Cold, 1 = Hot
    const h = smooth((humid + 1) / 2); // 0 = Dry, 1 = Wet

    // 3. Define the 4 Corners of our Climate Space

    // COLD & DRY (Tundra/Ice Plains)
    const pColdDry = { baseHeight: 18, amp: 6, freq: 1.0, warp: 10 };

    // COLD & WET (Ice Spikes/Snowy Mountains)
    const pColdWet = { baseHeight: 35, amp: 40, freq: 2.0, warp: 15 };

    // HOT & DRY (Desert/Dunes)
    const pHotDry = { baseHeight: 10, amp: 10, freq: 0.8, warp: 5 };

    // HOT & WET (Jungle/Mountains)
    const pHotWet = { baseHeight: 25, amp: 30, freq: 1.5, warp: 25 };

    // 4. Bilinear Interpolation
    // First blend along Humidity (Dry -> Wet) for both Temp poles
    const pCold = {
      baseHeight: lerp(pColdDry.baseHeight, pColdWet.baseHeight, h),
      amp: lerp(pColdDry.amp, pColdWet.amp, h),
      freq: lerp(pColdDry.freq, pColdWet.freq, h),
      warp: lerp(pColdDry.warp, pColdWet.warp, h),
    };

    const pHot = {
      baseHeight: lerp(pHotDry.baseHeight, pHotWet.baseHeight, h),
      amp: lerp(pHotDry.amp, pHotWet.amp, h),
      freq: lerp(pHotDry.freq, pHotWet.freq, h),
      warp: lerp(pHotDry.warp, pHotWet.warp, h),
    };

    // Now blend along Temperature (Cold -> Hot)
    return {
      baseHeight: lerp(pCold.baseHeight, pHot.baseHeight, t),
      amp: lerp(pCold.amp, pHot.amp, t),
      freq: lerp(pCold.freq, pHot.freq, t),
      warp: lerp(pCold.warp, pHot.warp, t),
    };
  }
  // --- 4. Vegetation Density Blending ---

  static getVegetationDensity(x: number, z: number): number {
    const { temp, humid } = this.getClimate(x, z);

    // Helper: smooth transition weights
    // Thresholds: -0.5 and 0.5 with 0.4 transition width (-0.7 to -0.3, 0.3 to 0.7)
    const cw = 0.2; // Blend width

    const wCold = smoothstep(-0.5 + cw, -0.5 - cw, temp);     // 1 when < -0.7
    const wHot = smoothstep(0.5 - cw, 0.5 + cw, temp);        // 1 when > 0.7
    const wTemperate = 1.0 - wCold - wHot;                    // Peak at 0

    const wDry = smoothstep(-0.5 + cw, -0.5 - cw, humid);     // 1 when < -0.7
    const wWet = smoothstep(0.5 - cw, 0.5 + cw, humid);       // 1 when > 0.7
    const wMid = 1.0 - wDry - wWet;

    // Define Densities for "Archetypal" Biome centers
    // Corresponds roughly to getBiomeVegetationDensity values

    // Cold Row
    const dColdDry = 0.3;   // Snow
    const dColdMid = 0.3;   // Snow
    const dColdWet = 0.05;  // Ice Spikes (Barren)

    // Temperate Row
    const dTempDry = 0.5;   // Plains
    const dTempMid = 0.85;  // The Grove (Lush) - Reduced from 0.95 for performance
    const dTempWet = 0.85;  // Jungle/Swamp-ish

    // Hot Row
    const dHotDry = 0.15;   // Desert
    const dHotMid = 0.4;    // Savanna
    const dHotWet = 0.85;   // Jungle

    // Bilinear Blend
    const dCold = dColdDry * wDry + dColdMid * wMid + dColdWet * wWet;
    const dTemp = dTempDry * wDry + dTempMid * wMid + dTempWet * wWet;
    const dHot = dHotDry * wDry + dHotMid * wMid + dHotWet * wWet;

    return dCold * wCold + dTemp * wTemperate + dHot * wHot;
  }

  // --- 5. Sacred Grove System ---
  // Sacred Groves are isolated barren clearings that spawn Root Hollows.
  // When a FractalTree grows, the area gradually transforms from barren to lush.
  //
  // TODO: Implement dynamic humidity spreading when FractalTree grows:
  // 1. Track active Root Hollows with grown trees in WorldStore
  // 2. Query active tree positions in getSacredGroveInfo()
  // 3. If tree is grown, invert the logic: lush at center, barren at edges
  // 4. Spread radius over time (requires chunk regeneration or dynamic material updates)
  // 5. Eventually spawn new trees/flora in the transformed zone

  /**
   * Detects if a world position is within a Sacred Grove pocket.
   * Returns: { inGrove: boolean, intensity: number (0-1), centerDistance: number }
   *
   * Sacred Groves appear as circular clearings in temperate zones (THE_GROVE biome region).
   * The terrain is flattened and barren (RED_DESERT material) until a tree grows.
   */
  static getSacredGroveInfo(x: number, z: number): {
    inGrove: boolean;
    intensity: number;
    isCenter: boolean;
  } {
    // Only create Sacred Groves in temperate, mid-humidity regions (THE_GROVE climate)
    const { temp, humid, continent } = this.getClimate(x, z);

    // Must be on land (not coastal/ocean)
    if (continent < 0.15) {
      return { inGrove: false, intensity: 0, isCenter: false };
    }

    // Must be temperate climate (where THE_GROVE would spawn)
    const isTemperate = temp > -0.4 && temp < 0.4;
    const isMidHumid = humid > -0.4 && humid < 0.4;

    if (!isTemperate || !isMidHumid) {
      return { inGrove: false, intensity: 0, isCenter: false };
    }

    // Sample Sacred Grove noise - creates isolated peaks
    const groveNoise = this.sacredGroveNoise(
      x * this.SACRED_GROVE_SCALE,
      z * this.SACRED_GROVE_SCALE
    );

    // Secondary noise for variation in pocket shapes
    const shapeNoise = this.sacredGroveNoise(
      x * this.SACRED_GROVE_SCALE * 2.5 + 100,
      z * this.SACRED_GROVE_SCALE * 2.5 + 100
    );

    // Grove thresholds - tuned for distinct, visible clearings
    // GROVE_THRESHOLD: 0.45 creates ~25% coverage - noticeable but not overwhelming
    // CENTER_THRESHOLD: 0.65 ensures Root Hollows only at the true center of each clearing
    // These values create roughly 1 clearing per 100-150 block area in THE_GROVE
    const GROVE_THRESHOLD = 0.45;
    const CENTER_THRESHOLD = 0.65;

    // Combine noises for organic shapes
    const combinedNoise = groveNoise * 0.7 + shapeNoise * 0.3;

    if (combinedNoise < GROVE_THRESHOLD) {
      return { inGrove: false, intensity: 0, isCenter: false };
    }

    // Calculate intensity (0 at edge, 1 at center)
    const intensity = (combinedNoise - GROVE_THRESHOLD) / (1.0 - GROVE_THRESHOLD);
    const isCenter = combinedNoise > CENTER_THRESHOLD;

    return { inGrove: true, intensity, isCenter };
  }

  /**
   * Returns terrain modification factors for Sacred Grove zones.
   * Used by TerrainService to flatten terrain and modify materials.
   */
  static getSacredGroveTerrainMod(x: number, z: number): {
    ampMultiplier: number;      // Reduce amplitude for flat clearing
    warpMultiplier: number;     // Reduce domain warping
    overhangMultiplier: number; // Reduce cliff/overhang noise
    useBarrenMaterial: boolean; // Apply RED_DESERT instead of GRASS
  } {
    const groveInfo = this.getSacredGroveInfo(x, z);

    if (!groveInfo.inGrove) {
      return {
        ampMultiplier: 1.0,
        warpMultiplier: 1.0,
        overhangMultiplier: 1.0,
        useBarrenMaterial: false
      };
    }

    // Stronger flattening toward center
    const flattenStrength = groveInfo.intensity;

    return {
      ampMultiplier: lerp(1.0, 0.15, flattenStrength),      // Very flat at center
      warpMultiplier: lerp(1.0, 0.2, flattenStrength),      // Minimal warping
      overhangMultiplier: lerp(1.0, 0.1, flattenStrength),  // No overhangs
      useBarrenMaterial: true  // Always barren within grove bounds
    };
  }
}

// Helper for smoothstep (standard GLSL implementation)
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// --- Debug Utilities ---
// Expose globally for console debugging: window.__findSacredGrove(playerX, playerZ)

/**
 * Find the nearest Sacred Grove center from a given position.
 * Usage in console: window.__findSacredGrove(x, z, searchRadius)
 * Returns direction and distance to nearest grove center.
 */
export function findNearestSacredGrove(
  fromX: number,
  fromZ: number,
  searchRadius: number = 500
): { found: boolean; x: number; z: number; distance: number; direction: string } | null {
  const step = 8; // Sample every 8 blocks for speed
  let nearest: { x: number; z: number; dist: number } | null = null;

  for (let dz = -searchRadius; dz <= searchRadius; dz += step) {
    for (let dx = -searchRadius; dx <= searchRadius; dx += step) {
      const wx = fromX + dx;
      const wz = fromZ + dz;

      const info = BiomeManager.getSacredGroveInfo(wx, wz);
      if (info.isCenter) {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (!nearest || dist < nearest.dist) {
          nearest = { x: wx, z: wz, dist };
        }
      }
    }
  }

  if (!nearest) {
    console.log(`No Sacred Grove centers found within ${searchRadius} blocks.`);
    console.log(`Try: window.__findSacredGrove(${fromX}, ${fromZ}, 1000)`);
    return null;
  }

  // Calculate cardinal direction
  const dx = nearest.x - fromX;
  const dz = nearest.z - fromZ;
  const angle = Math.atan2(dz, dx) * 180 / Math.PI;

  let direction = '';
  if (angle >= -22.5 && angle < 22.5) direction = 'East (+X)';
  else if (angle >= 22.5 && angle < 67.5) direction = 'Southeast (+X, +Z)';
  else if (angle >= 67.5 && angle < 112.5) direction = 'South (+Z)';
  else if (angle >= 112.5 && angle < 157.5) direction = 'Southwest (-X, +Z)';
  else if (angle >= 157.5 || angle < -157.5) direction = 'West (-X)';
  else if (angle >= -157.5 && angle < -112.5) direction = 'Northwest (-X, -Z)';
  else if (angle >= -112.5 && angle < -67.5) direction = 'North (-Z)';
  else direction = 'Northeast (+X, -Z)';

  const result = {
    found: true,
    x: nearest.x,
    z: nearest.z,
    distance: Math.round(nearest.dist),
    direction
  };

  console.log(`\n=== SACRED GROVE FOUND ===`);
  console.log(`Location: (${nearest.x}, ${nearest.z})`);
  console.log(`Distance: ${Math.round(nearest.dist)} blocks`);
  console.log(`Direction: ${direction}`);
  console.log(`\nWalk ${direction.toLowerCase()} for ~${Math.round(nearest.dist)} blocks.`);
  console.log(`========================\n`);

  return result;
}

// Debug: Sample Sacred Grove coverage in an area
export function debugSacredGroveCoverage(centerX: number, centerZ: number, radius: number = 200): void {
  const step = 4;
  let totalSamples = 0;
  let inGroveCount = 0;
  let isCenterCount = 0;
  let hasBarrenMaterial = 0;

  for (let dz = -radius; dz <= radius; dz += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      const wx = centerX + dx;
      const wz = centerZ + dz;
      totalSamples++;

      const info = BiomeManager.getSacredGroveInfo(wx, wz);
      const mod = BiomeManager.getSacredGroveTerrainMod(wx, wz);

      if (info.inGrove) inGroveCount++;
      if (info.isCenter) isCenterCount++;
      if (mod.useBarrenMaterial) hasBarrenMaterial++;
    }
  }

  console.log(`\n=== SACRED GROVE DEBUG (${radius * 2}x${radius * 2} area) ===`);
  console.log(`Total samples: ${totalSamples}`);
  console.log(`In Grove: ${inGroveCount} (${(inGroveCount / totalSamples * 100).toFixed(1)}%)`);
  console.log(`Is Center: ${isCenterCount} (${(isCenterCount / totalSamples * 100).toFixed(1)}%)`);
  console.log(`Barren Material: ${hasBarrenMaterial} (${(hasBarrenMaterial / totalSamples * 100).toFixed(1)}%)`);
  console.log(`==========================================\n`);
}

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as any).__findSacredGrove = findNearestSacredGrove;
  (window as any).__debugSacredGrove = debugSacredGroveCoverage;
  (window as any).__BiomeManager = BiomeManager;
}
