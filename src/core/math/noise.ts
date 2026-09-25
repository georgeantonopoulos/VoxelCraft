// A simple, self-contained noise implementation.
// Using a fixed permutation table ensures determinism across all chunks and sessions.

const PERM = new Uint8Array(512);
const p = new Uint8Array(256);

// Current seed value - can be reinitialized
let currentSeed = 1337;

// Seeded random number generator
function seededRandom(seed: { val: number }) {
  const x = Math.sin(seed.val++) * 10000;
  return x - Math.floor(x);
}

/**
 * Initialize or reinitialize the Perlin noise permutation table with a new seed.
 * Must be called before any noise generation for deterministic results.
 *
 * @param seed - The seed value (positive integer)
 */
export function initializeNoise(seed: number): void {
  currentSeed = seed;
  const seedState = { val: seed };

  // Initialize with sequential values
  for (let i = 0; i < 256; i++) {
    p[i] = i;
  }

  // Shuffle deterministically using the seed
  for (let i = 255; i > 0; i--) {
    const n = Math.floor(seededRandom(seedState) * (i + 1));
    const q = p[i];
    p[i] = p[n];
    p[n] = q;
  }

  // Double the permutation table for overflow handling
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
  }

  // console.log(`[Noise] Perlin noise initialized with seed: ${seed}`);
}

/**
 * Get the current noise seed.
 */
export function getNoiseSeed(): number {
  return currentSeed;
}

// Initialize with default seed on module load
initializeNoise(1337);

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number) {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number, z: number) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function noise(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;

  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);

  const u = fade(x);
  const v = fade(y);
  const w = fade(z);

  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;

  return lerp(w,
    lerp(v,
      lerp(u, grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z)),
      lerp(u, grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z))
    ),
    lerp(v,
      lerp(u, grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1)),
      lerp(u, grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1))
    )
  );
}

/**
 * Uniform deterministic hash in [0, 1) for placement decisions.
 *
 * Unlike (noise + 1) / 2 — which clusters around 0.5, so "p < 0.06" almost
 * never fires and positions bunch mid-range — this is uniformly distributed,
 * so thresholds read as real probabilities. Inputs are quantised to 1/64 so
 * the result is a pure function of world position (identical across chunks
 * and workers), salted per use and mixed with the world seed.
 */
export function hash01(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d);
  h ^= Math.imul(Math.round(y * 64) | 0, 0x165667b1);
  h ^= Math.imul(Math.round(z * 64) | 0, 0x9e3779b1);
  h ^= Math.imul(salt | 0, 0x85ebca77);
  h ^= Math.imul(currentSeed | 0, 0xc2b2ae3d);
  // murmur3 finaliser
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Measured spread of `noise()` (≈ normal, σ ≈ 0.25; p99 ≈ 0.55). */
const NOISE_SIGMA = 0.25;

/**
 * Map a Perlin sample to [0, 1) with an approximately uniform distribution
 * (normal CDF). Keeps spatial coherence (patches) while letting thresholds
 * such as "> 0.95" mean the top 5% instead of "practically never".
 */
export function noiseToUniform(n: number): number {
  const x = n / (NOISE_SIGMA * Math.SQRT2);
  // Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e-7)
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return Math.min(0.999999, Math.max(0, 0.5 * (1 + sign * y)));
}
