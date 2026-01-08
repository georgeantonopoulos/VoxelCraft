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
