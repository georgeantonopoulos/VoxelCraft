import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Performance Monitor: Measures frame time and logs diagnostics when FPS < 20.
 * Logs scene state, draw calls, and terrain internal queues to identify lag spikes.
 */
export const PerformanceMonitor: React.FC = () => {
    const { gl, camera, scene } = useThree();
    const lastTime = useRef(performance.now());
    const frameTimes = useRef<number[]>([]);
    const lastLogTime = useRef(0);

    useFrame(() => {
        const now = performance.now();
        const dt = now - lastTime.current;
        lastTime.current = now;

        // Sliding window of frame times
        frameTimes.current.push(dt);
        if (frameTimes.current.length > 30) frameTimes.current.shift();

        const avgFrameTime = frameTimes.current.reduce((a, b) => a + b, 0) / frameTimes.current.length;
        const fps = 1000 / avgFrameTime;

        // If FPS drops below 20 for the window (and not flooded), log diagnostics
        if (fps < 20 && now - lastLogTime.current > 3000) {
            lastLogTime.current = now;

            const diagnostics = (window as any).__vcDiagnostics || {};

            console.warn(`[PerformanceMonitor] FPS dropped to ${Math.round(fps)}! Diagnostics:`, {
                time: new Date().toLocaleTimeString(),
                fps: Math.round(fps),
                avgFrameTime: Math.round(avgFrameTime * 10) / 10,
                playerPos: camera.position.toArray().map(v => Math.round(v * 10) / 10),
                terrainState: { ...diagnostics },
                lastPropChange: diagnostics.lastPropChange,
                glInfo: {
                    drawCalls: gl.info.render.calls,
                    triangles: gl.info.render.triangles,
                    geometries: gl.info.memory.geometries,
                    textures: gl.info.memory.textures,
                    programs: gl.info.programs?.length
                },
                sceneObjects: scene.children.length
            });

            // Reset counters so the next log shows delta since last log
            diagnostics.totalChunkRenders = 0;
            diagnostics.geomCount = 0;
            diagnostics.terrainRenders = 0;
            diagnostics.terrainFrameTime = 0; // Reset max frame time
            diagnostics.minimapDrawTime = 0;
        }
    });

    return null;
};
