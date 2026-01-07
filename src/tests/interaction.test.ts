import { describe, it, expect } from 'vitest';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { MaterialType } from '@/types';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET } from '@/constants';

describe('Interaction Logic (TerrainService)', () => {
    it('should dig and reduce density', () => {
        const { density, material } = TerrainService.generateChunk(0, 0);

        // Find a solid point (e.g. at bottom)
        const cx = Math.floor(TOTAL_SIZE_XZ / 2);
        const cz = Math.floor(TOTAL_SIZE_XZ / 2);
        // Start from buffer index 10 (should be well below surface)
        const cy = 10;

        const idx = cx + cy * TOTAL_SIZE_XZ + cz * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

        // Force it solid for the test
        density[idx] = 100;
        material[idx] = MaterialType.STONE;

        const initialDensity = density[idx];

        // Calculate World Y corresponding to this buffer index
        const targetWorldY = (cy - PAD) + MESH_Y_OFFSET;

        const modified = TerrainService.modifyChunk(
            density,
            material,
            { x: cx - PAD, y: targetWorldY, z: cz - PAD }, // Local XZ, World Y
            2.0, // radius
            -10.0 // delta (dig)
        );

        expect(modified).toBe(true);
        expect(density[idx]).toBeLessThan(initialDensity);
    });
});
