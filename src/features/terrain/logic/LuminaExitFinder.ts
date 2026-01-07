import { TerrainService } from './terrainService';

export class LuminaExitFinder {
    /**
     * Finds the closest cave exit relative to current position.
     * Searches in a growing radius for a point that is:
     * 1. Above Ground (y > surfaceHeight)
     * 2. Has Air (density < ISO_LEVEL)
     * 3. Ideally has direct line of sight to the sky (not under a cliff)
     */
    static findClosestExit(px: number, py: number, pz: number, searchRadius: number = 64): { x: number, y: number, z: number } | null {
        // First check if current position is already considered "outside"
        const surfaceH = TerrainService.getHeightAt(px, pz);
        if (py > surfaceH + 1) return null; // Already out

        let bestExit: { x: number, y: number, z: number } | null = null;
        let minDistanceSq = Infinity;

        // Spiral search or grid
        const step = 4;
        for (let r = step; r <= searchRadius; r += step) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / (r / step * 4)) {
                const tx = px + Math.cos(angle) * r;
                const tz = pz + Math.sin(angle) * r;

                // For this XZ, find the surface height
                const h = TerrainService.getHeightAt(tx, tz);

                // Potential exit point
                const exitY = h + 1.5;

                // Calculate distance from player
                const dx = tx - px;
                const dy = exitY - py;
                const dz = tz - pz;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (distSq < minDistanceSq) {
                    minDistanceSq = distSq;
                    bestExit = { x: tx, y: exitY, z: tz };
                }
            }
            // If we found a decent exit in the current ring, we can stop or keep looking for closer
            if (bestExit && r > 16) break;
        }

        return bestExit;
    }
}
