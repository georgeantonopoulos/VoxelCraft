/**
 * WorldSeed - Centralized seed management for deterministic world generation.
 *
 * The seed controls all noise-based generation:
 * - Terrain height and shape (Perlin noise in noise.ts)
 * - Biome distribution (Simplex noise in BiomeManager)
 * - Vegetation placement
 * - Cave systems
 *
 * Usage:
 * - Call WorldSeed.initialize(seed) before any terrain generation
 * - Use WorldSeed.get() to read the current seed
 * - Workers must be notified separately via CONFIGURE message
 */

type SeedChangeListener = (seed: number) => void;

class WorldSeedManager {
  private _seed: number = 1337; // Default seed for backwards compatibility
  private _initialized: boolean = false;
  private _listeners: SeedChangeListener[] = [];

  /**
   * Get the current world seed.
   */
  get(): number {
    return this._seed;
  }

  /**
   * Check if the seed has been explicitly set.
   */
  isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Initialize or change the world seed.
   * This should be called early in app startup, before terrain generation begins.
   *
   * @param seed - The seed value (will be converted to a positive integer)
   */
  set(seed: number): void {
    // Normalize seed to a positive integer
    const normalizedSeed = Math.abs(Math.floor(seed)) || 1;

    if (this._seed === normalizedSeed && this._initialized) {
      return; // No change needed
    }

    this._seed = normalizedSeed;
    this._initialized = true;

    // console.log(`[WorldSeed] Seed set to: ${this._seed}`);

    // Notify listeners
    for (const listener of this._listeners) {
      listener(this._seed);
    }
  }

  /**
   * Generate a random seed based on current time.
   */
  generateRandom(): number {
    return Math.floor(Math.random() * 2147483647) + 1; // Max safe 32-bit positive integer
  }

  /**
   * Parse seed from URL parameter or generate new one.
   * Looks for ?seed=12345 in the URL.
   */
  fromURLOrRandom(): number {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const seedParam = params.get('seed');
      if (seedParam) {
        const parsed = parseInt(seedParam, 10);
        if (!isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
    return this.generateRandom();
  }

  /**
   * Subscribe to seed changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: SeedChangeListener): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Reset to uninitialized state (for testing or world restart).
   */
  reset(): void {
    this._seed = 1337;
    this._initialized = false;
  }
}

// Export singleton instance
export const WorldSeed = new WorldSeedManager();
