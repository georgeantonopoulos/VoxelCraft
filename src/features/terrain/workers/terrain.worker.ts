import { getChunkModifications, makeWorldKey, setWorldKey } from '@/state/WorldDB';
import { initializeNoise } from '@core/math/noise';
import { BiomeManager } from '../logic/BiomeManager';
import { buildGeneratedChunk, buildRemeshedChunk, GrownTreeInfo, RemeshRequest } from '../logic/chunkPipeline';

/**
 * Terrain worker: a thin message router around logic/chunkPipeline.ts.
 * Every job replies (GENERATED / REMESHED / ERROR) so the main thread's
 * in-flight tracking never leaks.
 */
const ctx: Worker = self as any;

let profileMode = false;

// Grown trees for Sacred Grove humidity spreading (UPDATE_GROWN_TREES).
let grownTreesCache: GrownTreeInfo[] = [];

ctx.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;
    try {
        if (type === 'CONFIGURE') {
            const { worldType, seed, profile: enableProfile } = payload;
            if (enableProfile !== undefined) profileMode = enableProfile;
            if (seed !== undefined) {
                BiomeManager.reinitialize(seed);
                // Static import: awaiting a dynamic import here let a GENERATE that
                // arrived meanwhile run with the previous seed and world key.
                initializeNoise(seed);
                (self as any).worldSeed = seed;
            }
            if (worldType !== undefined) {
                BiomeManager.setWorldType(worldType);
                (self as any).worldType = worldType;
            }
            if ((self as any).worldSeed !== undefined && (self as any).worldType !== undefined) {
                setWorldKey(makeWorldKey((self as any).worldSeed, (self as any).worldType));
            }
        } else if (type === 'UPDATE_GROWN_TREES') {
            grownTreesCache = payload.trees || [];
        } else if (type === 'GENERATE') {
            const { cx, cz } = payload;
            let modifications: Awaited<ReturnType<typeof getChunkModifications>> = [];
            try { modifications = await getChunkModifications(cx, cz); } catch (err) { console.error('[terrain.worker] DB Read Error:', err); }
            const start = profileMode ? performance.now() : 0;
            const result = buildGeneratedChunk(cx, cz, modifications, grownTreesCache);
            if (profileMode) console.log(`[terrain.worker] GENERATE ${cx},${cz}: ${(performance.now() - start).toFixed(1)}ms`);
            ctx.postMessage({ type: 'GENERATED', payload: result.payload }, result.transfers);
        } else if (type === 'REMESH') {
            const result = buildRemeshedChunk(payload as RemeshRequest, grownTreesCache);
            ctx.postMessage({ type: 'REMESHED', payload: result.payload }, result.transfers);
        }
    } catch (error) {
        console.error('Worker Error:', error);
        // Always answer: the main thread tracks the job as in flight until a reply
        // arrives, and silent failures eventually stalled all streaming.
        const cx = payload?.cx, cz = payload?.cz;
        ctx.postMessage({
            type: 'ERROR',
            payload: {
                jobType: type,
                key: payload?.key ?? (cx !== undefined && cz !== undefined ? `${cx},${cz}` : undefined),
                message: String((error as Error)?.message ?? error),
            },
        });
    }
};
