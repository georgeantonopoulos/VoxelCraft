import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { MeshData } from '@/types';
import { getChunkModifications } from '@/state/WorldDB';

// Type alias to ensure TypeScript recognizes all MeshData properties
type CompleteMeshData = MeshData & {
    materials2: Float32Array;
    materials3: Float32Array;
    meshWeights: Float32Array;
};

const ctx: Worker = self as any;

// Instantiate DB connection implicitly by importing it (Singleton in WorldDB.ts)
// The user requested: "Ensure you instantiate WorldDB outside the onmessage handler."
// Since `worldDB` is exported as a const instance in `WorldDB.ts`, it is instantiated on module load.
// We don't need to do anything extra here, just usage is fine.

ctx.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        if (type === 'GENERATE') {
            const { cx, cz } = payload;
            const t0 = performance.now();
            console.log('[terrain.worker] GENERATE start', cx, cz);

            // 1. Fetch persistent modifications (Async)
            // This happens BEFORE generation so we can pass them in
            let modifications: any[] = [];
            try {
                modifications = await getChunkModifications(cx, cz);
            } catch (err) {
                console.error('[terrain.worker] DB Read Error:', err);
                // Continue generation even if DB fails, to avoid game crash
            }

            // 2. Generate with mods
            const { density, material, metadata, floraPositions, rootHollowPositions } = TerrainService.generateChunk(cx, cz, modifications);

            const mesh = generateMesh(density, material, metadata.wetness, metadata.mossiness) as CompleteMeshData;

            console.log('[terrain.worker] GENERATE done', cx, cz, {
                positions: mesh.positions.length,
                ms: Math.round(performance.now() - t0),
                mods: modifications.length
            });

            const response = {
                key: `${cx},${cz}`,
                cx, cz,
                density,
                material,
                metadata,
                floraPositions,
                rootHollowPositions,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMaterials: mesh.materials,
                meshMaterials2: mesh.materials2,
                meshMaterials3: mesh.materials3,
                meshWeights: mesh.meshWeights,
                meshNormals: mesh.normals,
                meshWetness: mesh.wetness,
                meshMossiness: mesh.mossiness,
                waterPositions: mesh.waterPositions,
                waterIndices: mesh.waterIndices,
                waterNormals: mesh.waterNormals
            };

            ctx.postMessage({ type: 'GENERATED', payload: response }, [
                density.buffer,
                material.buffer,
                metadata.wetness.buffer,
                metadata.mossiness.buffer,
                floraPositions.buffer,
                rootHollowPositions.buffer,
                mesh.positions.buffer,
                mesh.indices.buffer,
                mesh.materials.buffer,
                mesh.materials2.buffer,
                mesh.materials3.buffer,
                mesh.meshWeights.buffer,
                mesh.normals.buffer,
                mesh.wetness.buffer,
                mesh.mossiness.buffer,
                mesh.waterPositions.buffer,
                mesh.waterIndices.buffer,
                mesh.waterNormals.buffer
            ]);
        } else if (type === 'REMESH') {
            const { density, material, key, cx, cz, version } = payload;

            const t0 = performance.now();
            // console.log('[terrain.worker] REMESH start', key, 'v', version);
            const mesh = generateMesh(density, material) as CompleteMeshData;
            // console.log('[terrain.worker] REMESH done', key);

            const response = {
                key, cx, cz,
                density,
                version,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMaterials: mesh.materials,
                meshMaterials2: mesh.materials2,
                meshMaterials3: mesh.materials3,
                meshWeights: mesh.meshWeights,
                meshNormals: mesh.normals,
                meshWetness: mesh.wetness,
                meshMossiness: mesh.mossiness,
                waterPositions: mesh.waterPositions,
                waterIndices: mesh.waterIndices,
                waterNormals: mesh.waterNormals
            };

            ctx.postMessage({ type: 'REMESHED', payload: response }, [
                mesh.positions.buffer,
                mesh.indices.buffer,
                mesh.materials.buffer,
                mesh.materials2.buffer,
                mesh.materials3.buffer,
                mesh.meshWeights.buffer,
                mesh.normals.buffer,
                mesh.wetness.buffer,
                mesh.mossiness.buffer,
                mesh.waterPositions.buffer,
                mesh.waterIndices.buffer,
                mesh.waterNormals.buffer
            ]);
        }
    } catch (error) {
        console.error('Worker Error:', error);
    }
};
