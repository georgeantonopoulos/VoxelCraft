import React, { useEffect } from 'react';
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

    useEffect(() => {
        if (!ready) return;
        let cancelled = false;
        // Let the first streamed chunks and effects mount before compiling.
        const id = window.setTimeout(() => {
            if (cancelled) return;
            // Without the parallel-compile extension compileAsync only warns and
            // compiles synchronously anyway; do that directly (once, at load).
            if (gl.extensions.has('KHR_parallel_shader_compile')) {
                gl.compileAsync(scene, camera).catch(() => { /* best effort */ });
            } else {
                gl.compile(scene, camera);
            }
        }, WARMUP_DELAY_MS);
        return () => { cancelled = true; window.clearTimeout(id); };
    }, [ready, gl, scene, camera]);

    return null;
};
