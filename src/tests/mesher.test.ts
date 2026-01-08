import { describe, it, expect } from 'vitest';
import { generateMesh } from '@features/terrain/logic/mesher';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, ISO_LEVEL } from '@/constants';
import { MaterialType, MeshData } from '@/types';

const SIZE = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;

/**
 * Helper to validate collider data is valid for Rapier.
 * Rapier throws "expected instance of _TA" if arrays are empty or malformed.
 */
function validateColliderData(mesh: MeshData): void {
  if (mesh.isHeightfield) {
    // Heightfield collider should have valid heightfield data
    expect(mesh.colliderHeightfield).toBeDefined();
    expect(mesh.colliderHeightfield!.length).toBeGreaterThan(0);
  } else if (mesh.colliderPositions && mesh.colliderIndices) {
    // Trimesh collider: if we have positions, must have valid indices
    if (mesh.colliderPositions.length > 0) {
      expect(mesh.colliderIndices.length).toBeGreaterThan(0);
      // Indices must be valid (< vertex count)
      const vertexCount = mesh.colliderPositions.length / 3;
      for (let i = 0; i < mesh.colliderIndices.length; i++) {
        expect(mesh.colliderIndices[i]).toBeLessThan(vertexCount);
      }
    }
    // Empty collider is also valid (for fully air chunks)
  }
}

describe('Mesher', () => {
    it('should generate empty mesh for air chunk', () => {
        const density = new Float32Array(SIZE).fill(-100); // All air
        const material = new Uint8Array(SIZE).fill(MaterialType.AIR);

        const mesh = generateMesh(density, material);
        expect(mesh.positions.length).toBe(0);
        expect(mesh.indices.length).toBe(0);
    });

    it('should generate empty mesh for solid chunk (internal)', () => {
        const density = new Float32Array(SIZE).fill(100); // All solid
        const material = new Uint8Array(SIZE).fill(MaterialType.STONE);

        const mesh = generateMesh(density, material);
        // Should be empty because no surface transition inside the chunk
        expect(mesh.positions.length).toBe(0);
        expect(mesh.indices.length).toBe(0);
    });

    it('should generate geometry for a single voxel', () => {
        const density = new Float32Array(SIZE).fill(-100); // Air
        const material = new Uint8Array(SIZE).fill(MaterialType.AIR);

        // Place a solid voxel in the center
        const x = Math.floor(TOTAL_SIZE_XZ / 2);
        const y = Math.floor(TOTAL_SIZE_Y / 2);
        const z = Math.floor(TOTAL_SIZE_XZ / 2);
        const idx = x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

        density[idx] = 100; // Solid
        material[idx] = MaterialType.STONE;

        const mesh = generateMesh(density, material);
        expect(mesh.positions.length).toBeGreaterThan(0);
        expect(mesh.indices.length).toBeGreaterThan(0);
    });

    it('should generate valid collider data for terrain with caves (trimesh)', () => {
        // Create terrain with caves/overhangs to force trimesh collider
        const density = new Float32Array(SIZE);
        const material = new Uint8Array(SIZE);

        const bufIdx = (x: number, y: number, z: number) =>
            x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

        // Fill with solid ground up to y=40, then air above, with a cave
        for (let z = 0; z < TOTAL_SIZE_XZ; z++) {
            for (let y = 0; y < TOTAL_SIZE_Y; y++) {
                for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
                    const idx = bufIdx(x, y, z);
                    if (y < 40) {
                        density[idx] = 1.0; // Solid
                        material[idx] = MaterialType.STONE;
                    } else {
                        density[idx] = -1.0; // Air
                        material[idx] = MaterialType.AIR;
                    }
                }
            }
        }

        // Carve a cave (air pocket under solid) to force trimesh instead of heightfield
        for (let z = PAD + 5; z < PAD + 15; z++) {
            for (let y = PAD + 10; y < PAD + 20; y++) {
                for (let x = PAD + 5; x < PAD + 15; x++) {
                    const idx = bufIdx(x, y, z);
                    density[idx] = -1.0; // Air pocket
                    material[idx] = MaterialType.AIR;
                }
            }
        }

        const mesh = generateMesh(density, material);

        // Should produce trimesh collider (not heightfield) due to cave
        expect(mesh.isHeightfield).toBe(false);

        // Validate the collider data is valid for Rapier
        validateColliderData(mesh);

        // Should have actual geometry
        expect(mesh.positions.length).toBeGreaterThan(0);
        expect(mesh.colliderPositions!.length).toBeGreaterThan(0);
        expect(mesh.colliderIndices!.length).toBeGreaterThan(0);
    });

    it('should generate valid heightfield for simple flat terrain', () => {
        const density = new Float32Array(SIZE);
        const material = new Uint8Array(SIZE);

        const bufIdx = (x: number, y: number, z: number) =>
            x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

        // Simple flat terrain: solid below y=30, air above
        for (let z = 0; z < TOTAL_SIZE_XZ; z++) {
            for (let y = 0; y < TOTAL_SIZE_Y; y++) {
                for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
                    const idx = bufIdx(x, y, z);
                    if (y < 30) {
                        density[idx] = 1.0;
                        material[idx] = MaterialType.STONE;
                    } else {
                        density[idx] = -1.0;
                        material[idx] = MaterialType.AIR;
                    }
                }
            }
        }

        const mesh = generateMesh(density, material);

        // Should use heightfield for simple terrain (no caves)
        expect(mesh.isHeightfield).toBe(true);

        // Validate collider data
        validateColliderData(mesh);
    });
});
