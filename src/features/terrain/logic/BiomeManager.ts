import { makeNoise2D } from 'fast-simplex-noise';
import { MaterialType } from '@/types';

export type BiomeType =
  | 'PLAINS'
  | 'DESERT'
  | 'SNOW'
  | 'MOUNTAINS'
  | 'JUNGLE'
  | 'SAVANNA'
  | 'ICE_SPIKES'
  | 'RED_DESERT'
  | 'SKY_ISLANDS' // Special case
  | 'THE_GROVE'; // Default/Temperate

export interface BiomeCaveSettings {
  scale: number;      // How "zoomed out" the noise is (lower = bigger caves)
  threshold: number;  // Cavity thickness (higher = wider tunnels)
  frequency: number;  // Wiggle factor (higher = more twisted)
  surfaceBreachChance: number; // 0..1 chance of caves breaking surface (modulated by noise)
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

// Helper function for linear interpolation
const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;

// Helper to smooth the noise input (removes harsh linearity)
const smooth = (t: number) => t * t * (3 - 2 * t);

export class BiomeManager {
  // Using a fixed seed for now, could be passed in
  private static seed = 1337;

  // 2D Noise functions for macro-climate
  private static tempNoise = makeNoise2D(() => this.hash(this.seed + 1));
  private static humidNoise = makeNoise2D(() => this.hash(this.seed + 2));

  // Scales
  static readonly TEMP_SCALE = 0.0013; // 1.5x larger biomes (was 0.002)
  static readonly HUMID_SCALE = 0.0013;

  // Simple pseudo-random for seeding
  private static hash(n: number): number {
    n = Math.sin(n) * 43758.5453123;
    return n - Math.floor(n);
  }

  // --- 1. Biome Classification ---

  static getClimate(x: number, z: number): { temp: number, humid: number } {
    // Normalize to -1..1 range (fast-simplex-noise usually returns -1..1)
    const temp = this.tempNoise(x * this.TEMP_SCALE, z * this.TEMP_SCALE);
    const humid = this.humidNoise(x * this.HUMID_SCALE, z * this.HUMID_SCALE);
    return { temp, humid };
  }

  static getBiomeAt(x: number, z: number): BiomeType {
    const { temp, humid } = this.getClimate(x, z);
    return this.getBiomeFromClimate(temp, humid);
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
    const { temp, humid } = this.getClimate(x, z);
    return this.getTerrainParametersFromClimate(temp, humid);
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
    const dTempMid = 0.95;  // The Grove (Lush)
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
}

// Helper for smoothstep (standard GLSL implementation)
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
