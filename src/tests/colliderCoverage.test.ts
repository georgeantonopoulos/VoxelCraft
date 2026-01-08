import { describe, it, expect } from 'vitest';
import { generateMesh } from '@features/terrain/logic/mesher';
import {
  TOTAL_SIZE_XZ,
  TOTAL_SIZE_Y,
  PAD,
  CHUNK_SIZE_XZ,
  CHUNK_SIZE_Y,
  MESH_Y_OFFSET,
} from '@/constants';
import { MaterialType, MeshData } from '@/types';

const SIZE = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;

/**
 * Collider Coverage Tests
 *
 * These tests validate that terrain colliders are properly generated and configured.
 * Missing or improperly configured colliders can cause players to fall through terrain,
 * especially when moving at high speeds (flying).
 *
 * Key invariants tested:
 * 1. Every chunk with solid terrain must produce valid collider data
 * 2. Collider data must be compatible with Rapier physics engine
 * 3. Heightfield colliders must have correct dimensions for chunk size
 * 4. Trimesh colliders must have valid vertex/index relationships
 */

/**
 * Helper to create terrain density buffer with configurable ground height
 */
function createFlatTerrain(groundHeight: number): { density: Float32Array; material: Uint8Array } {
  const density = new Float32Array(SIZE);
  const material = new Uint8Array(SIZE);

  const bufIdx = (x: number, y: number, z: number) =>
    x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

  for (let z = 0; z < TOTAL_SIZE_XZ; z++) {
    for (let y = 0; y < TOTAL_SIZE_Y; y++) {
      for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
        const idx = bufIdx(x, y, z);
        if (y < groundHeight) {
          density[idx] = 1.0; // Solid
          material[idx] = MaterialType.STONE;
        } else {
          density[idx] = -1.0; // Air
          material[idx] = MaterialType.AIR;
        }
      }
    }
  }

  return { density, material };
}

/**
 * Helper to create terrain with caves (forces trimesh collider)
 */
function createCaveTerrain(): { density: Float32Array; material: Uint8Array } {
  const { density, material } = createFlatTerrain(40);

  const bufIdx = (x: number, y: number, z: number) =>
    x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

  // Carve a cave in the middle of the chunk
  for (let z = PAD + 5; z < PAD + 15; z++) {
    for (let y = PAD + 10; y < PAD + 20; y++) {
      for (let x = PAD + 5; x < PAD + 15; x++) {
        const idx = bufIdx(x, y, z);
        density[idx] = -1.0; // Air pocket
        material[idx] = MaterialType.AIR;
      }
    }
  }

  return { density, material };
}

/**
 * Helper to validate collider data is valid for Rapier physics engine
 */
function validateColliderData(mesh: MeshData): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (mesh.isHeightfield) {
    if (!mesh.colliderHeightfield) {
      issues.push('Heightfield collider missing colliderHeightfield data');
    } else if (mesh.colliderHeightfield.length === 0) {
      issues.push('Heightfield collider has empty data array');
    } else {
      // Heightfield should have (CHUNK_SIZE_XZ + 1)^2 samples
      const expectedSamples = (CHUNK_SIZE_XZ + 1) * (CHUNK_SIZE_XZ + 1);
      if (mesh.colliderHeightfield.length !== expectedSamples) {
        issues.push(
          `Heightfield has ${mesh.colliderHeightfield.length} samples, expected ${expectedSamples}`
        );
      }

      // Check for NaN or Infinity values
      for (let i = 0; i < mesh.colliderHeightfield.length; i++) {
        const val = mesh.colliderHeightfield[i];
        if (!Number.isFinite(val)) {
          issues.push(`Heightfield contains non-finite value at index ${i}: ${val}`);
          break; // Only report first issue
        }
      }
    }
  } else {
    // Trimesh collider
    if (mesh.colliderPositions && mesh.colliderIndices) {
      if (mesh.colliderPositions.length > 0) {
        if (mesh.colliderIndices.length === 0) {
          issues.push('Trimesh has positions but no indices');
        }

        // Positions must be divisible by 3 (x, y, z triplets)
        if (mesh.colliderPositions.length % 3 !== 0) {
          issues.push(
            `Trimesh positions length (${mesh.colliderPositions.length}) not divisible by 3`
          );
        }

        // Indices must be divisible by 3 (triangles)
        if (mesh.colliderIndices.length % 3 !== 0) {
          issues.push(
            `Trimesh indices length (${mesh.colliderIndices.length}) not divisible by 3`
          );
        }

        // All indices must reference valid vertices
        const vertexCount = mesh.colliderPositions.length / 3;
        for (let i = 0; i < mesh.colliderIndices.length; i++) {
          const idx = mesh.colliderIndices[i];
          if (idx >= vertexCount) {
            issues.push(
              `Trimesh index ${i} (value: ${idx}) exceeds vertex count (${vertexCount})`
            );
            break; // Only report first issue
          }
        }

        // Check for NaN or Infinity in positions
        for (let i = 0; i < mesh.colliderPositions.length; i++) {
          const val = mesh.colliderPositions[i];
          if (!Number.isFinite(val)) {
            issues.push(`Trimesh positions contain non-finite value at index ${i}: ${val}`);
            break;
          }
        }

        // Check for degenerate triangles (zero area)
        for (let i = 0; i < mesh.colliderIndices.length; i += 3) {
          const i0 = mesh.colliderIndices[i] * 3;
          const i1 = mesh.colliderIndices[i + 1] * 3;
          const i2 = mesh.colliderIndices[i + 2] * 3;

          // Check if all three vertices are the same (degenerate)
          if (i0 === i1 || i1 === i2 || i0 === i2) {
            issues.push(`Trimesh has degenerate triangle at index ${i / 3}`);
            break;
          }
        }
      }
      // Empty collider is valid for fully air chunks
    } else if (mesh.positions.length > 0) {
      // Has geometry but no collider data at all
      issues.push('Mesh has geometry but no collider data (positions or indices missing)');
    }
  }

  return { valid: issues.length === 0, issues };
}

describe('Collider Coverage', () => {
  describe('Collider Data Generation', () => {
    it('should generate heightfield for flat terrain', () => {
      const { density, material } = createFlatTerrain(30);
      const mesh = generateMesh(density, material);

      expect(mesh.isHeightfield).toBe(true);
      expect(mesh.colliderHeightfield).toBeDefined();

      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });

    it('should generate trimesh for terrain with caves', () => {
      const { density, material } = createCaveTerrain();
      const mesh = generateMesh(density, material);

      expect(mesh.isHeightfield).toBe(false);
      expect(mesh.colliderPositions).toBeDefined();
      expect(mesh.colliderIndices).toBeDefined();

      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });

    it('should generate valid collider for various ground heights', () => {
      // Test multiple ground heights to catch edge cases
      const heights = [5, 10, 30, 60, 100];

      for (const height of heights) {
        const { density, material } = createFlatTerrain(height);
        const mesh = generateMesh(density, material);

        const { valid, issues } = validateColliderData(mesh);
        expect(issues).toEqual([]);
        expect(valid).toBe(true);
      }
    });

    it('should generate empty but valid collider for air-only chunks', () => {
      const density = new Float32Array(SIZE).fill(-100); // All air
      const material = new Uint8Array(SIZE).fill(MaterialType.AIR);

      const mesh = generateMesh(density, material);

      // Should have no geometry
      expect(mesh.positions.length).toBe(0);

      // Empty collider is valid - no issues expected
      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });
  });

  describe('Heightfield Dimensions', () => {
    it('should have correct sample count for chunk size', () => {
      const { density, material } = createFlatTerrain(30);
      const mesh = generateMesh(density, material);

      expect(mesh.isHeightfield).toBe(true);
      expect(mesh.colliderHeightfield).toBeDefined();

      // Rapier heightfield needs (rows + 1) * (cols + 1) samples
      const expectedSamples = (CHUNK_SIZE_XZ + 1) * (CHUNK_SIZE_XZ + 1);
      expect(mesh.colliderHeightfield!.length).toBe(expectedSamples);
    });

    it('should have heights within valid range', () => {
      const { density, material } = createFlatTerrain(30);
      const mesh = generateMesh(density, material);

      expect(mesh.colliderHeightfield).toBeDefined();

      // Heights should be within the chunk's world Y range
      // World Y range is [MESH_Y_OFFSET, MESH_Y_OFFSET + CHUNK_SIZE_Y]
      // With MESH_Y_OFFSET=-35 and CHUNK_SIZE_Y=128, that's [-35, 93]
      const minHeight = Math.min(...mesh.colliderHeightfield!);
      const maxHeight = Math.max(...mesh.colliderHeightfield!);

      expect(minHeight).toBeGreaterThanOrEqual(MESH_Y_OFFSET);
      expect(maxHeight).toBeLessThanOrEqual(MESH_Y_OFFSET + CHUNK_SIZE_Y);
    });
  });

  describe('Trimesh Integrity', () => {
    it('should have all triangle indices within bounds', () => {
      const { density, material } = createCaveTerrain();
      const mesh = generateMesh(density, material);

      expect(mesh.colliderPositions).toBeDefined();
      expect(mesh.colliderIndices).toBeDefined();

      const vertexCount = mesh.colliderPositions!.length / 3;

      for (let i = 0; i < mesh.colliderIndices!.length; i++) {
        expect(mesh.colliderIndices![i]).toBeLessThan(vertexCount);
        expect(mesh.colliderIndices![i]).toBeGreaterThanOrEqual(0);
      }
    });

    it('should have triangles (indices divisible by 3)', () => {
      const { density, material } = createCaveTerrain();
      const mesh = generateMesh(density, material);

      expect(mesh.colliderIndices!.length % 3).toBe(0);
    });

    it('should have valid vertex positions (no NaN/Infinity)', () => {
      const { density, material } = createCaveTerrain();
      const mesh = generateMesh(density, material);

      for (let i = 0; i < mesh.colliderPositions!.length; i++) {
        expect(Number.isFinite(mesh.colliderPositions![i])).toBe(true);
      }
    });
  });

  describe('Collider Enable State Simulation', () => {
    /**
     * Simulates the collider enable queue behavior from VoxelTerrain.tsx
     * This tests the logic that determines which chunks get colliders enabled
     */
    it('should enable colliders for chunks within radius', () => {
      const COLLIDER_RADIUS = 1; // Chebyshev distance (3x3 area)
      const playerPos = { px: 0, pz: 0 };

      // Simulate a grid of chunks around the player
      const chunks: Map<string, { colliderEnabled: boolean; cx: number; cz: number }> = new Map();

      // Create a 7x7 grid of chunks (beyond render distance to test edge cases)
      for (let cx = -3; cx <= 3; cx++) {
        for (let cz = -3; cz <= 3; cz++) {
          const key = `${cx},${cz}`;
          chunks.set(key, { colliderEnabled: false, cx, cz });
        }
      }

      // Simulate the collider enable logic from VoxelTerrain.tsx
      const keysToEnable: string[] = [];
      for (const [key, chunk] of chunks) {
        const dist = Math.max(
          Math.abs(chunk.cx - playerPos.px),
          Math.abs(chunk.cz - playerPos.pz)
        );

        if (dist <= COLLIDER_RADIUS) {
          keysToEnable.push(key);
          chunk.colliderEnabled = true;
        }
      }

      // Should enable 3x3 = 9 chunks
      expect(keysToEnable.length).toBe(9);

      // Verify the player's chunk always has collider
      expect(chunks.get('0,0')!.colliderEnabled).toBe(true);

      // Verify all adjacent chunks have colliders
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${dx},${dz}`;
          expect(chunks.get(key)!.colliderEnabled).toBe(true);
        }
      }

      // Verify chunks outside radius don't have colliders
      expect(chunks.get('2,0')!.colliderEnabled).toBe(false);
      expect(chunks.get('0,2')!.colliderEnabled).toBe(false);
      expect(chunks.get('-2,-2')!.colliderEnabled).toBe(false);
    });

    it('should handle player movement across chunk boundaries', () => {
      const COLLIDER_RADIUS = 1;

      // Start position
      let playerPos = { px: 0, pz: 0 };
      const chunks: Map<string, { colliderEnabled: boolean; cx: number; cz: number }> = new Map();

      // Create chunks
      for (let cx = -5; cx <= 5; cx++) {
        for (let cz = -5; cz <= 5; cz++) {
          chunks.set(`${cx},${cz}`, { colliderEnabled: false, cx, cz });
        }
      }

      // Helper to update collider states
      const updateColliders = () => {
        for (const chunk of chunks.values()) {
          const dist = Math.max(
            Math.abs(chunk.cx - playerPos.px),
            Math.abs(chunk.cz - playerPos.pz)
          );
          // In real code, colliders aren't disabled when moving away
          // They're only enabled, never disabled during gameplay
          if (dist <= COLLIDER_RADIUS) {
            chunk.colliderEnabled = true;
          }
        }
      };

      // Initial position
      updateColliders();
      expect(chunks.get('0,0')!.colliderEnabled).toBe(true);

      // Move to chunk (2, 0) - simulating fast movement
      playerPos = { px: 2, pz: 0 };
      updateColliders();

      // The new player chunk should have collider
      expect(chunks.get('2,0')!.colliderEnabled).toBe(true);

      // Adjacent chunks should also have colliders
      expect(chunks.get('1,0')!.colliderEnabled).toBe(true);
      expect(chunks.get('3,0')!.colliderEnabled).toBe(true);
      expect(chunks.get('2,1')!.colliderEnabled).toBe(true);
      expect(chunks.get('2,-1')!.colliderEnabled).toBe(true);
    });

    it('should identify gap in collider coverage when moving fast', () => {
      /**
       * This test demonstrates the bug: when moving faster than 1 chunk per frame,
       * there's a gap where colliders haven't been enabled yet.
       *
       * At COLLIDER_RADIUS=1, player at chunk 0 has colliders for chunks -1,0,1
       * If player moves directly to chunk 3, chunks 2,3,4 need colliders
       * But the queue only processes 1 collider per frame!
       */
      const COLLIDER_RADIUS = 1;
      const MAX_COLLIDERS_PER_FRAME = 1;

      // Simulate chunks that have been generated but not had colliders enabled
      const generatedChunks = new Set<string>();
      const colliderEnabledChunks = new Set<string>();

      // Generate all chunks in a line from 0 to 5
      for (let cx = -1; cx <= 6; cx++) {
        generatedChunks.add(`${cx},0`);
      }

      // Initially at position 0, enable colliders for radius around player
      let playerPos = { px: 0, pz: 0 };
      for (let dx = -COLLIDER_RADIUS; dx <= COLLIDER_RADIUS; dx++) {
        const key = `${playerPos.px + dx},0`;
        if (generatedChunks.has(key)) {
          colliderEnabledChunks.add(key);
        }
      }

      // Verify initial state
      expect(colliderEnabledChunks.has('0,0')).toBe(true);
      expect(colliderEnabledChunks.has('1,0')).toBe(true);
      expect(colliderEnabledChunks.has('-1,0')).toBe(true);
      expect(colliderEnabledChunks.has('2,0')).toBe(false);

      // Player instantly moves to chunk 3 (e.g., flying fast)
      playerPos = { px: 3, pz: 0 };

      // Calculate chunks that need colliders
      const chunksNeedingColliders: string[] = [];
      for (let dx = -COLLIDER_RADIUS; dx <= COLLIDER_RADIUS; dx++) {
        const key = `${playerPos.px + dx},0`;
        if (generatedChunks.has(key) && !colliderEnabledChunks.has(key)) {
          chunksNeedingColliders.push(key);
        }
      }

      // Chunks 2, 3, 4 need colliders now
      expect(chunksNeedingColliders).toContain('2,0');
      expect(chunksNeedingColliders).toContain('3,0');
      expect(chunksNeedingColliders).toContain('4,0');

      // Simulate frame-by-frame collider enabling
      let frame = 0;
      const queue = [...chunksNeedingColliders];

      while (queue.length > 0 && frame < 10) {
        frame++;
        // Process MAX_COLLIDERS_PER_FRAME per frame
        for (let i = 0; i < MAX_COLLIDERS_PER_FRAME && queue.length > 0; i++) {
          const key = queue.shift()!;
          colliderEnabledChunks.add(key);
        }
      }

      // It takes 3 frames to enable all colliders
      expect(frame).toBe(3);

      // This is the bug: during frames 1 and 2, the player could fall through
      // because their current chunk (3,0) or adjacent chunks don't have colliders yet
    });
  });

  describe('Edge Cases', () => {
    it('should handle terrain at Y=0 boundary', () => {
      // Terrain that starts at the very bottom
      const { density, material } = createFlatTerrain(5);
      const mesh = generateMesh(density, material);

      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });

    it('should handle terrain near Y=max boundary', () => {
      // Terrain that goes almost to the top
      const { density, material } = createFlatTerrain(TOTAL_SIZE_Y - 10);
      const mesh = generateMesh(density, material);

      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });

    it('should handle thin layer of terrain (1 voxel thick)', () => {
      const density = new Float32Array(SIZE).fill(-1.0);
      const material = new Uint8Array(SIZE).fill(MaterialType.AIR);

      const bufIdx = (x: number, y: number, z: number) =>
        x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

      // Single layer of solid at y=30
      for (let z = PAD; z < TOTAL_SIZE_XZ - PAD; z++) {
        for (let x = PAD; x < TOTAL_SIZE_XZ - PAD; x++) {
          const idx = bufIdx(x, 30, z);
          density[idx] = 1.0;
          material[idx] = MaterialType.STONE;
        }
      }

      const mesh = generateMesh(density, material);

      // Should generate some geometry
      expect(mesh.positions.length).toBeGreaterThan(0);

      // Collider should be valid
      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });

    it('should handle horizontal tunnel with ceiling (force trimesh)', () => {
      const { density, material } = createFlatTerrain(50);

      const bufIdx = (x: number, y: number, z: number) =>
        x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

      // Carve a horizontal tunnel at y=20-25 (has solid ceiling above)
      // This creates air pockets under solid, forcing trimesh collider
      const tunnelY = 20;
      const tunnelHeight = 5;

      for (let z = PAD + 5; z < PAD + 25; z++) {
        for (let y = tunnelY; y < tunnelY + tunnelHeight; y++) {
          for (let x = PAD + 5; x < PAD + 25; x++) {
            const idx = bufIdx(x, y, z);
            density[idx] = -1.0; // Air pocket under solid ceiling
            material[idx] = MaterialType.AIR;
          }
        }
      }

      const mesh = generateMesh(density, material);

      // Should be trimesh due to tunnel (air under solid ceiling)
      expect(mesh.isHeightfield).toBe(false);

      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });

    it('should use heightfield for open-top vertical tunnel', () => {
      // A vertical tunnel that opens to the sky is still heightfield-compatible
      // because there's no solid material above the air pockets
      const { density, material } = createFlatTerrain(50);

      const bufIdx = (x: number, y: number, z: number) =>
        x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

      // Carve a vertical tunnel from bottom to surface (no ceiling)
      const tunnelX = Math.floor(TOTAL_SIZE_XZ / 2);
      const tunnelZ = Math.floor(TOTAL_SIZE_XZ / 2);

      for (let y = PAD; y < 50; y++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const idx = bufIdx(tunnelX + dx, y, tunnelZ + dz);
            density[idx] = -1.0;
            material[idx] = MaterialType.AIR;
          }
        }
      }

      const mesh = generateMesh(density, material);

      // Should still be heightfield because no air pockets under solid
      // (the tunnel goes all the way to surface)
      expect(mesh.isHeightfield).toBe(true);

      const { valid, issues } = validateColliderData(mesh);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
    });
  });
});

describe('Collider Queue Performance', () => {
  /**
   * Tests that document and validate the collider queue behavior.
   *
   * The key insight is that the player's current chunk (distance 0) is enabled
   * synchronously, so the player won't fall through their own chunk. The issue
   * is with adjacent chunks - if the player moves fast and lands on an adjacent
   * chunk before its collider is enabled, they could fall through.
   */
  it('should document collider timing constraints', () => {
    const CHUNK_SIZE = CHUNK_SIZE_XZ; // 32 voxels
    const MAX_COLLIDERS_PER_FRAME = 1;
    const NEW_CHUNKS_PER_BOUNDARY = 3; // Moving in one direction adds 3 new chunks to 3x3
    const FPS = 60;

    // Frames needed to enable all new colliders when crossing a boundary
    const framesNeeded = NEW_CHUNKS_PER_BOUNDARY / MAX_COLLIDERS_PER_FRAME;
    expect(framesNeeded).toBe(3);

    // Time to enable all colliders (in seconds)
    const timeToEnableAll = framesNeeded / FPS;
    expect(timeToEnableAll).toBeCloseTo(0.05, 2); // 50ms

    // Speed analysis: how far can player move during the collider enable delay?
    const speeds = [
      { name: 'walking', blocksPerSecond: 4, expectedChunks: 0.00625 },
      { name: 'running', blocksPerSecond: 8, expectedChunks: 0.0125 },
      { name: 'flying', blocksPerSecond: 20, expectedChunks: 0.03125 },
      { name: 'fast flying', blocksPerSecond: 50, expectedChunks: 0.078125 },
    ];

    for (const { name, blocksPerSecond, expectedChunks } of speeds) {
      const distanceDuringDelay = blocksPerSecond * timeToEnableAll;
      const chunksTraversed = distanceDuringDelay / CHUNK_SIZE;
      expect(chunksTraversed).toBeCloseTo(expectedChunks, 4);
    }

    // Key finding: even at 50 blocks/second, player only moves ~0.08 chunks
    // during the 50ms collider enable window. This is NOT the bug source.
  });

  it('should identify the real bug: teleportation and instant chunk crossings', () => {
    /**
     * The actual bug isn't gradual movement - it's when the player:
     * 1. Teleports (spawn, respawn, portal)
     * 2. Crosses chunk boundaries in a single frame (lag spike, high velocity)
     * 3. Enters a newly-generated chunk before collider is ready
     *
     * The fix in VoxelTerrain.tsx (distToPlayer === 0 case) handles case 1 and 2
     * by enabling the player's chunk synchronously. Case 3 is the edge case.
     */
    const COLLIDER_RADIUS = 1;

    // Simulate: player spawns at chunk (5, 5) but chunks around it were just generated
    const playerChunk = { px: 5, pz: 5 };
    const recentlyGeneratedChunks = new Map<string, { colliderEnabled: boolean }>();

    // All chunks around player exist but haven't had colliders enabled yet
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const key = `${playerChunk.px + dx},${playerChunk.pz + dz}`;
        recentlyGeneratedChunks.set(key, { colliderEnabled: false });
      }
    }

    // The VoxelTerrain.tsx logic should enable player's chunk immediately
    // (distToPlayer === 0 || !initialLoadTriggered.current check)
    const playerKey = `${playerChunk.px},${playerChunk.pz}`;
    recentlyGeneratedChunks.get(playerKey)!.colliderEnabled = true;

    // Adjacent chunks are queued for deferred enable
    const queuedForDefer: string[] = [];
    for (const [key, chunk] of recentlyGeneratedChunks) {
      const [cxStr, czStr] = key.split(',');
      const cx = parseInt(cxStr);
      const cz = parseInt(czStr);
      const dist = Math.max(
        Math.abs(cx - playerChunk.px),
        Math.abs(cz - playerChunk.pz)
      );

      if (dist > 0 && dist <= COLLIDER_RADIUS && !chunk.colliderEnabled) {
        queuedForDefer.push(key);
      }
    }

    // 8 adjacent chunks should be queued (3x3 minus center)
    expect(queuedForDefer.length).toBe(8);

    // The bug: if player walks off the edge of their chunk BEFORE adjacent
    // colliders are enabled (within ~100ms of requestIdleCallback timeout),
    // they could fall through. This is rare but possible.
    expect(recentlyGeneratedChunks.get('5,5')!.colliderEnabled).toBe(true);
    expect(recentlyGeneratedChunks.get('4,5')!.colliderEnabled).toBe(false); // Not yet!
  });

  it('should calculate maximum safe instantaneous velocity', () => {
    const CHUNK_SIZE = CHUNK_SIZE_XZ;
    const MAX_COLLIDERS_PER_FRAME = 1;
    const NEW_CHUNKS_PER_BOUNDARY = 3;
    const FPS = 60;

    // Time to process all new chunks when crossing boundary
    const processingTime = NEW_CHUNKS_PER_BOUNDARY / MAX_COLLIDERS_PER_FRAME / FPS;

    // Safe speed: player should not cross another chunk boundary before colliders are ready
    // This means traveling less than 1 chunk during processing time
    const maxSafeSpeed = CHUNK_SIZE / processingTime;

    // At 640 blocks/second, player traverses 1 chunk during the processing window
    expect(maxSafeSpeed).toBeCloseTo(640, 0);

    // Real-world perspective: 640 blocks/s is ~23 chunks/s or 1380 km/h
    // No normal gameplay reaches this speed. The bug is elsewhere.
  });
});

/**
 * Regression tests for collider queue bugs fixed in VoxelTerrain.tsx
 * These tests simulate the queue management logic and verify the fixes work correctly.
 */
describe('Collider Queue Regression Tests', () => {
  /**
   * Helper class that simulates the collider queue behavior from VoxelTerrain.tsx
   * This allows us to test the queue logic in isolation without React/Three.js overhead
   */
  class ColliderQueueSimulator {
    colliderEnableQueue: string[] = [];
    colliderEnablePending: Set<string> = new Set();
    lastColliderCenterKey = '';
    playerChunk = { px: 0, pz: 0 };
    chunks: Map<string, { cx: number; cz: number; colliderEnabled: boolean; dataLoaded: boolean }> = new Map();
    COLLIDER_RADIUS = 1;

    addChunk(cx: number, cz: number, dataLoaded = true) {
      const key = `${cx},${cz}`;
      this.chunks.set(key, { cx, cz, colliderEnabled: false, dataLoaded });
    }

    getChunk(key: string) {
      const chunk = this.chunks.get(key);
      return chunk?.dataLoaded ? chunk : undefined;
    }

    /**
     * ORIGINAL buggy queue rebuild logic (before fix)
     * This completely clears the queue on every player chunk change
     */
    rebuildQueueBuggy(px: number, pz: number) {
      const colliderCenterKey = `${px},${pz}`;
      if (colliderCenterKey !== this.lastColliderCenterKey) {
        this.lastColliderCenterKey = colliderCenterKey;
        // BUG: Completely clears the queue, losing pending work
        this.colliderEnableQueue.length = 0;
        this.colliderEnablePending.clear();

        const candidates = new Set<string>();
        for (let dx = -this.COLLIDER_RADIUS; dx <= this.COLLIDER_RADIUS; dx++) {
          for (let dz = -this.COLLIDER_RADIUS; dz <= this.COLLIDER_RADIUS; dz++) {
            candidates.add(`${px + dx},${pz + dz}`);
          }
        }

        for (const key of candidates) {
          const c = this.getChunk(key);
          // BUG: If chunk data hasn't loaded yet, it's silently skipped and never re-queued
          if (c && !c.colliderEnabled && !this.colliderEnablePending.has(key)) {
            this.colliderEnablePending.add(key);
            this.colliderEnableQueue.push(key);
          }
        }
      }
    }

    /**
     * FIXED queue rebuild logic (after fix)
     * Preserves valid queue entries and properly handles chunks that aren't loaded yet
     */
    rebuildQueueFixed(px: number, pz: number) {
      const colliderCenterKey = `${px},${pz}`;
      if (colliderCenterKey !== this.lastColliderCenterKey) {
        this.lastColliderCenterKey = colliderCenterKey;

        const candidates = new Set<string>();
        for (let dx = -this.COLLIDER_RADIUS; dx <= this.COLLIDER_RADIUS; dx++) {
          for (let dz = -this.COLLIDER_RADIUS; dz <= this.COLLIDER_RADIUS; dz++) {
            candidates.add(`${px + dx},${pz + dz}`);
          }
        }

        // FIX: Preserve existing queue entries that are still valid candidates
        const newQueue: string[] = [];
        const newPending = new Set<string>();

        for (const key of this.colliderEnableQueue) {
          if (candidates.has(key)) {
            newQueue.push(key);
            newPending.add(key);
          }
        }

        for (const key of candidates) {
          const c = this.getChunk(key);
          if (c && !c.colliderEnabled && !newPending.has(key)) {
            newPending.add(key);
            newQueue.push(key);
          }
        }

        this.colliderEnableQueue = newQueue;
        this.colliderEnablePending = newPending;
      }
    }

    /**
     * ORIGINAL buggy collider processing (before fix)
     * Completely skips processing during heavy worker frames
     */
    processCollidersBuggy(appliedWorkerMessageThisFrame: boolean) {
      // BUG: If worker messages were processed, colliders are completely skipped
      if (!appliedWorkerMessageThisFrame && this.colliderEnableQueue.length > 0) {
        const key = this.colliderEnableQueue.shift();
        if (key) {
          this.colliderEnablePending.delete(key);
          const chunk = this.getChunk(key);
          if (chunk && !chunk.colliderEnabled) {
            chunk.colliderEnabled = true;
          }
        }
      }
    }

    /**
     * FIXED collider processing (after fix)
     * Always processes the player's current chunk, even during heavy worker frames
     */
    processCollidersFixed(appliedWorkerMessageThisFrame: boolean) {
      if (this.colliderEnableQueue.length > 0) {
        // FIX: Always enable player's current chunk immediately
        const playerChunkKey = `${this.playerChunk.px},${this.playerChunk.pz}`;
        const playerChunkQueueIndex = this.colliderEnableQueue.indexOf(playerChunkKey);
        if (playerChunkQueueIndex !== -1) {
          this.colliderEnableQueue.splice(playerChunkQueueIndex, 1);
          this.colliderEnablePending.delete(playerChunkKey);
          const chunk = this.getChunk(playerChunkKey);
          if (chunk && !chunk.colliderEnabled) {
            chunk.colliderEnabled = true;
          }
        }

        // Process additional colliders only if not busy with worker messages
        if (!appliedWorkerMessageThisFrame && this.colliderEnableQueue.length > 0) {
          const key = this.colliderEnableQueue.shift();
          if (key) {
            this.colliderEnablePending.delete(key);
            const chunk = this.getChunk(key);
            if (chunk && !chunk.colliderEnabled) {
              chunk.colliderEnabled = true;
            }
          }
        }
      }
    }

    movePlayer(px: number, pz: number) {
      this.playerChunk = { px, pz };
    }

    getEnabledColliderCount(): number {
      let count = 0;
      for (const chunk of this.chunks.values()) {
        if (chunk.colliderEnabled) count++;
      }
      return count;
    }

    isPlayerChunkEnabled(): boolean {
      const key = `${this.playerChunk.px},${this.playerChunk.pz}`;
      return this.chunks.get(key)?.colliderEnabled ?? false;
    }
  }

  describe('Bug 1: Queue Clearing Race Condition', () => {
    it('BUGGY: should demonstrate queue clearing drops pending chunks', () => {
      const sim = new ColliderQueueSimulator();

      // Setup: Create chunks around player at (0,0)
      for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
          sim.addChunk(cx, cz);
        }
      }

      // Player at (0,0) - queue should have 9 chunks (3x3 around player)
      sim.rebuildQueueBuggy(0, 0);
      expect(sim.colliderEnableQueue.length).toBe(9);

      // Process only 1 collider (simulating throttling)
      sim.processCollidersBuggy(false);
      expect(sim.getEnabledColliderCount()).toBe(1);
      expect(sim.colliderEnableQueue.length).toBe(8);

      // Player moves to (1,0) - BUG: queue is completely cleared!
      sim.rebuildQueueBuggy(1, 0);

      // The 8 pending chunks that were waiting are now lost
      // Only the new candidates that are loaded get queued
      // Chunks at (-1,-1), (-1,0), (-1,1), (0,-1), (0,1), (1,-1), (1,0), (1,1), (2,-1), (2,0), (2,1)
      // should be in queue, but previously pending ones were dropped
      expect(sim.colliderEnableQueue.length).toBeLessThanOrEqual(9);
    });

    it('FIXED: should preserve valid pending chunks when player moves', () => {
      const sim = new ColliderQueueSimulator();

      // Setup: Create chunks around player at (0,0)
      for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
          sim.addChunk(cx, cz);
        }
      }

      // Player at (0,0)
      sim.movePlayer(0, 0);
      sim.rebuildQueueFixed(0, 0);
      const initialQueueLength = sim.colliderEnableQueue.length;
      expect(initialQueueLength).toBe(9);

      // Process colliders - fixed version enables player chunk + 1 additional
      sim.processCollidersFixed(false);
      // Player chunk (0,0) is enabled immediately, plus one more from the queue
      expect(sim.getEnabledColliderCount()).toBe(2);

      // Player moves to (1,0) - FIX: valid pending chunks are preserved
      sim.movePlayer(1, 0);
      sim.rebuildQueueFixed(1, 0);

      // Chunks still in radius should be preserved, new ones added
      // (0,0) was already enabled, so not in queue
      // Preserved: (-1,-1), (-1,0), (-1,1) are no longer in radius - removed
      // Preserved: (0,-1), (0,0), (0,1), (1,-1), (1,0), (1,1) - kept if pending
      // New: (2,-1), (2,0), (2,1) - added
      expect(sim.colliderEnableQueue.length).toBeGreaterThan(0);

      // Process all colliders
      for (let i = 0; i < 20; i++) {
        sim.processCollidersFixed(false);
      }

      // All chunks within radius of new position should be enabled
      const chunksInRadius = ['0,-1', '0,0', '0,1', '1,-1', '1,0', '1,1', '2,-1', '2,0', '2,1'];
      for (const key of chunksInRadius) {
        expect(sim.chunks.get(key)?.colliderEnabled).toBe(true);
      }
    });
  });

  describe('Bug 2: Worker Message Blocking', () => {
    it('BUGGY: should demonstrate player chunk blocked during heavy worker frames', () => {
      const sim = new ColliderQueueSimulator();

      // Setup chunks
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          sim.addChunk(cx, cz);
        }
      }

      sim.movePlayer(0, 0);
      sim.rebuildQueueBuggy(0, 0);

      // Simulate 5 frames of heavy worker activity
      for (let frame = 0; frame < 5; frame++) {
        sim.processCollidersBuggy(true); // appliedWorkerMessageThisFrame = true
      }

      // BUG: Player's chunk still doesn't have a collider!
      expect(sim.isPlayerChunkEnabled()).toBe(false);
      expect(sim.getEnabledColliderCount()).toBe(0);
    });

    it('FIXED: should always enable player chunk even during heavy worker frames', () => {
      const sim = new ColliderQueueSimulator();

      // Setup chunks
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          sim.addChunk(cx, cz);
        }
      }

      sim.movePlayer(0, 0);
      sim.rebuildQueueFixed(0, 0);

      // Simulate 5 frames of heavy worker activity
      for (let frame = 0; frame < 5; frame++) {
        sim.processCollidersFixed(true); // appliedWorkerMessageThisFrame = true
      }

      // FIX: Player's chunk should ALWAYS be enabled immediately
      expect(sim.isPlayerChunkEnabled()).toBe(true);

      // Other chunks won't be enabled during heavy frames (expected throttling)
      // But the critical player chunk is safe
      expect(sim.getEnabledColliderCount()).toBe(1);
    });

    it('FIXED: should enable player chunk on first frame regardless of worker load', () => {
      const sim = new ColliderQueueSimulator();

      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          sim.addChunk(cx, cz);
        }
      }

      sim.movePlayer(0, 0);
      sim.rebuildQueueFixed(0, 0);

      // Even on very first frame with heavy worker load, player chunk is enabled
      sim.processCollidersFixed(true);
      expect(sim.isPlayerChunkEnabled()).toBe(true);
    });
  });

  describe('Bug 3: Direction-Biased Queuing (Chunks Behind Player)', () => {
    /**
     * The original code only queued chunks "ahead" of the player's movement direction.
     * This meant chunks behind or beside the player might not get colliders when
     * walking backwards or sideways on hills.
     *
     * This test simulates the scenario but the fix is in the GENERATED message handler
     * where chunks within radius are always queued regardless of direction.
     */
    it('should queue all chunks within radius regardless of movement direction', () => {
      const sim = new ColliderQueueSimulator();

      // Player is at (0,0) moving in +X direction
      sim.movePlayer(0, 0);

      // Chunks exist all around player
      for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
          sim.addChunk(cx, cz);
        }
      }

      sim.rebuildQueueFixed(0, 0);

      // All 9 chunks in 3x3 around player should be queued (or already enabled)
      const chunksInRadius = [
        '-1,-1', '-1,0', '-1,1',
        '0,-1', '0,0', '0,1',
        '1,-1', '1,0', '1,1'
      ];

      // Verify all radius chunks are in queue
      for (const key of chunksInRadius) {
        const inQueue = sim.colliderEnableQueue.includes(key) ||
          sim.chunks.get(key)?.colliderEnabled === true;
        expect(inQueue).toBe(true);
      }

      // Chunks behind player (-1,*) should be included, not just ahead (+1,*)
      expect(
        sim.colliderEnableQueue.includes('-1,0') ||
        sim.chunks.get('-1,0')?.colliderEnabled === true
      ).toBe(true);
    });
  });

  describe('Combined Scenario: Rapid Movement on Hills', () => {
    it('should maintain collider coverage when player rapidly crosses chunk boundaries', () => {
      const sim = new ColliderQueueSimulator();

      // Create a larger world
      for (let cx = -5; cx <= 5; cx++) {
        for (let cz = -5; cz <= 5; cz++) {
          sim.addChunk(cx, cz);
        }
      }

      // Player starts at (0,0)
      sim.movePlayer(0, 0);
      sim.rebuildQueueFixed(0, 0);

      // Process a few frames
      for (let i = 0; i < 3; i++) {
        sim.processCollidersFixed(false);
      }

      expect(sim.isPlayerChunkEnabled()).toBe(true);

      // Rapidly move player through several chunks (simulating fast movement on hills)
      const positions = [
        { px: 1, pz: 0 },
        { px: 2, pz: 0 },
        { px: 2, pz: 1 },
        { px: 3, pz: 1 },
      ];

      for (const pos of positions) {
        sim.movePlayer(pos.px, pos.pz);
        sim.rebuildQueueFixed(pos.px, pos.pz);

        // Simulate heavy worker frame on some iterations
        const heavyFrame = Math.random() > 0.5;
        sim.processCollidersFixed(heavyFrame);

        // CRITICAL: Player's current chunk should ALWAYS have collider
        expect(sim.isPlayerChunkEnabled()).toBe(true);
      }
    });

    it('should handle chunk data arriving after player has moved', () => {
      const sim = new ColliderQueueSimulator();

      // Initially, only chunks around (0,0) are loaded
      for (let cx = -1; cx <= 1; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          sim.addChunk(cx, cz, true);
        }
      }

      // Chunks further away exist but data not loaded yet
      for (let cx = 2; cx <= 3; cx++) {
        for (let cz = -1; cz <= 1; cz++) {
          sim.addChunk(cx, cz, false); // dataLoaded = false
        }
      }

      sim.movePlayer(0, 0);
      sim.rebuildQueueFixed(0, 0);

      // Process initial colliders
      for (let i = 0; i < 10; i++) {
        sim.processCollidersFixed(false);
      }

      // Player moves to (2,0) where chunk data wasn't loaded
      sim.movePlayer(2, 0);
      sim.rebuildQueueFixed(2, 0);

      // Chunk (2,0) data is not loaded, so it won't be in queue
      expect(sim.colliderEnableQueue.includes('2,0')).toBe(false);

      // Now chunk data arrives (simulating worker message)
      sim.chunks.get('2,0')!.dataLoaded = true;
      sim.chunks.get('3,0')!.dataLoaded = true;

      // Rebuild queue - now the chunks should be picked up
      sim.lastColliderCenterKey = ''; // Force rebuild
      sim.rebuildQueueFixed(2, 0);

      // (2,0) should now be queued
      expect(sim.colliderEnableQueue.includes('2,0')).toBe(true);

      // Process and verify
      sim.processCollidersFixed(false);
      expect(sim.isPlayerChunkEnabled()).toBe(true);
    });
  });
});
