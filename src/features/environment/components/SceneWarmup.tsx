import React, { useEffect, useState } from 'react';
import { Campfire } from '@features/interaction/components/Campfire';
import { TorchModel } from '@features/interaction/components/TorchModel';
import { KeeperFist } from '@features/interaction/components/KeeperHand';
import { UniversalTool } from '@features/interaction/components/UniversalTool';
import { LogMesh, PlankMesh } from '@features/building/components/Log';
import { ItemType } from '@/types';
import { useThree } from '@react-three/fiber';

/**
 * SceneWarmup: precompiles every material in the scene once the world has
 * loaded, so the first spark, swarm or torch effect doesn't stall a frame on
 * shader compilation.
 *
 * compileAsync uses KHR_parallel_shader_compile where available, so the
 * programs build off the main thread. It covers everything mounted at that
 * point, including pooled effects with zero live instances. The light count
 * must stay constant for the cached programs to remain valid: see
 * PointLightPool and TorchTool.
 *
 * (The previous version rendered hand-copied shaders inside an invisible group.
 * three.js never draws invisible objects, and program caching is keyed on the
 * exact shader text, so it warmed nothing.)
 */
const WARMUP_DELAY_MS = 1500;

export const SceneWarmup: React.FC<{ ready: boolean }> = ({ ready }) => {
    const gl = useThree((s) => s.gl);
    const scene = useThree((s) => s.scene);
    const camera = useThree((s) => s.camera);
    // Things that first appear mid-play (a campfire, a log, a torch, an item
    // in flight) are mounted far below the world during the warm-up so their
    // programs compile now, not with a stall the first time they appear.
    const [prototypes, setPrototypes] = useState(true);

    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        // Let the first streamed chunks and effects mount before compiling.
        const id = window.setTimeout(() => {
            if (cancelled) return;
            const done = () => { if (!cancelled) window.setTimeout(() => setPrototypes(false), 1000); };
            // Without the parallel-compile extension compileAsync only warns and
            // compiles synchronously anyway; do that directly (once, at load).
            if (gl.extensions.has('KHR_parallel_shader_compile')) {
                // Same as gl.compileAsync, but tolerant of a material being
                // disposed while it waits (terrain layers swap materials during
                // load; three's version then throws on the missing program and
                // never resolves).
                const materials = gl.compile(scene, camera);
                const poll = () => {
                    if (cancelled) return;
                    materials.forEach((m) => {
                        const program = (gl.properties.get(m) as { currentProgram?: { isReady: () => boolean } }).currentProgram;
                        if (!program || program.isReady()) materials.delete(m);
                    });
                    if (materials.size === 0) done();
                    else window.setTimeout(poll, 10);
                };
                poll();
            } else {
                gl.compile(scene, camera);
                done();
            }
        }, WARMUP_DELAY_MS);
        return () => { cancelled = true; window.clearTimeout(id); };
    }, [ready, gl, scene, camera]);

    if (!prototypes) return null;
    return (
        <group position={[0, -4000, 0]}>
            <Campfire />
            <TorchModel length={0.5} />
            <KeeperFist />
            <LogMesh length={1} radius={0.15} bark="#5b4a38" />
            <PlankMesh length={1} halfWidth={0.14} bark="#5b4a38" />
            {[ItemType.STICK, ItemType.STONE, ItemType.SHARD, ItemType.FLORA].map((t) => <UniversalTool key={t} item={t} />)}
        </group>
    );
};
