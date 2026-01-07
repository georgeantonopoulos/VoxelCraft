import { describe, it, expect } from 'vitest';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, MESH_Y_OFFSET, PAD } from '@/constants';
import { MaterialType } from '@/types';

describe('TerrainService', () => {
    it('should generate chunks with correct dimensions', () => {
        const { density, material } = TerrainService.generateChunk(0, 0);
        const expectedSize = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;
        expect(density.length).toBe(expectedSize);
        expect(material.length).toBe(expectedSize);
    });

    it('should be deterministic', () => {
        const chunkA = TerrainService.generateChunk(0, 0);
        const chunkB = TerrainService.generateChunk(0, 0);
        expect(chunkA.density).toEqual(chunkB.density);
        expect(chunkA.material).toEqual(chunkB.material);
    });

    it('should have bedrock at deep depths', () => {
        const { material } = TerrainService.generateChunk(0, 0);
        // Check the bottom layer
        const y = 0; // Local index in buffer
        const wy = (y - PAD) + MESH_Y_OFFSET;

        // Ensure we are checking below bedrock threshold
        // MESH_Y_OFFSET is -35. PAD is 2. y=0 => wy = -37.
        // Bedrock logic is typically wy <= MESH_Y_OFFSET + 4
        expect(wy).toBeLessThanOrEqual(MESH_Y_OFFSET + 4);

        // Check a sample point in the middle of XZ plane at bottom Y
        const x = Math.floor(TOTAL_SIZE_XZ / 2);
        const z = Math.floor(TOTAL_SIZE_XZ / 2);
        const idx = x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

        expect(material[idx]).toBe(MaterialType.BEDROCK);
    });
});
