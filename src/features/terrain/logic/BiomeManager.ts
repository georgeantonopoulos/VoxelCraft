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

interface BiomeParameters {
  id: BiomeType;
  surfaceMaterial: MaterialType;
  subSurfaceMaterial: MaterialType;
  liquidMaterial: MaterialType; // Water or maybe Lava/Ice

  // Terrain shaping parameters
  baseHeight: number;
  heightAmp: number;      // Multiplier for height noise
  roughness: number;      // Frequency of detail noise
  warpStrength: number;   // Domain warp amount
}

export class BiomeManager {
  // Using a fixed seed for now, could be passed in
  private static seed = 1337;

  // 2D Noise functions for macro-climate
  private static tempNoise = makeNoise2D(() => this.hash(this.seed + 1));
  private static humidNoise = makeNoise2D(() => this.hash(this.seed + 2));

  // Detail noises for height - distinct from TerrainService to allow specialized biome shapes?
  // Actually TerrainService uses its own noise.
  // For 'getBlendedHeight', we might want to return PARAMETERS to TerrainService
  // so it can generate the density/height using its loop efficiently.

  // Scales
  static readonly TEMP_SCALE = 0.002;
  static readonly HUMID_SCALE = 0.002;

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

    // Rare Sky Islands check (can be position based or noise based)
    // Let's say it happens in very specific humidity/temp pockets or just random patches
    // The user suggested: "Rare occurrence where Heat is High + Humidity is Low + Random 'Magic' factor"
    // For now, let's stick to the table logic first.

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
      case 'SAVANNA': return MaterialType.DIRT; // Dried grass look?
      case 'MOUNTAINS': return MaterialType.STONE;
      case 'PLAINS': return MaterialType.GRASS;
      case 'THE_GROVE': return MaterialType.GRASS;
      case 'SKY_ISLANDS': return MaterialType.GRASS;
      default: return MaterialType.GRASS;
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

    // Define "Poles"
    // Cold/Dry (Ice Plains): Flat, High base
    // Hot/Dry (Desert): Flat, Low base
    // Hot/Wet (Jungle): Rugged, High Amp
    // Temperate (Grove): Rolling, Medium Amp

    // Baseline (The Grove)
    let baseHeight = 14;
    let amp = 8;     // Continental noise multiplier
    let freq = 1.0;  // Multiplier for noise coordinate scaling
    let warp = 15.0; // Warp strength

    // Temperature Influence
    // Hotter = often more extreme or flatter depending on biome
    if (temp > 0.5) {
      // Hot
      if (humid < -0.2) {
        // Desert/Red Desert - Flat dunes
        amp = 4;
        warp = 5;
        baseHeight = 10;
      } else if (humid > 0.2) {
        // Jungle - Rugged
        amp = 25;
        freq = 1.5;
        warp = 25;
        baseHeight = 20;
      } else {
        // Savanna - Plateau-ish (Shattered Savanna logic)
        amp = 15;
        baseHeight = 30; // High plateau
      }
    } else if (temp < -0.5) {
      // Cold
      if (humid > 0.5) {
        // Ice Spikes - Extreme chaotic
        amp = 40;
        freq = 2.0;
        warp = 10;
      } else {
        // Snow/Tundra - Gentle
        amp = 6;
        baseHeight = 18;
      }
    } else {
      // Temperate
      if (humid > 0.6) {
        // Swamp/Dense Forest - Low, wet
        baseHeight = 8;
        amp = 4;
      } else if (Math.abs(temp) < 0.2 && Math.abs(humid) < 0.2) {
        // "The Grove" (Classic) - Keep default
      }
    }

    // Smooth blending via linear interpolation could be added here
    // by defining specific parameter sets for 4 corners and bilinear interpolating
    // based on temp/humid, but this conditional logic + smooth noise driving it
    // creates decent transitions if the noise frequency is low.

    return { baseHeight, amp, freq, warp };
  }
}
