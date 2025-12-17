import { describe, it, expect } from 'vitest';
import { generateMesh } from '@features/terrain/logic/mesher';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y } from '@/constants';
import { MaterialType } from '@/types';

const SIZE = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;

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
});
