import React, { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Stats } from '@react-three/drei';

interface PerformanceMonitorProps {
    visible?: boolean;
}

/**
 * Performance Monitor: Measures frame time and logs diagnostics when FPS < 20.
 * Also provides an on-screen visual overlay of detailed stats when visible.
 */
export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({ visible }) => {
    const { gl, camera, scene } = useThree();
    const lastTime = useRef(performance.now());
    const frameTimes = useRef<number[]>([]);
    const lastLogTime = useRef(0);
    const frameCount = useRef(0);

    // Visual stats state
    const [glStats, setGlStats] = useState({
        calls: 0,
        triangles: 0,
        geometries: 0,
        textures: 0,
        programs: 0,
        entities: 0
    });

    useFrame(() => {
        const now = performance.now();
        const dt = now - lastTime.current;
        lastTime.current = now;

        // Sliding window of frame times for logic
        frameTimes.current.push(dt);
        if (frameTimes.current.length > 30) frameTimes.current.shift();

        const avgFrameTime = frameTimes.current.reduce((a, b) => a + b, 0) / frameTimes.current.length;
        const fps = 1000 / avgFrameTime;

        // Visual Stats Update (every 30 frames)
        if (visible) {
            frameCount.current++;
            if (frameCount.current % 30 === 0) {
                setGlStats({
                    calls: gl.info.render.calls,
                    triangles: gl.info.render.triangles,
                    geometries: gl.info.memory.geometries,
                    textures: gl.info.memory.textures,
                    programs: gl.info.programs?.length || 0,
                    entities: scene.children.length
                });
            }
        }

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

            // Reset counters
            diagnostics.totalChunkRenders = 0;
            diagnostics.geomCount = 0;
            diagnostics.terrainRenders = 0;
            diagnostics.terrainFrameTime = 0;
            diagnostics.minimapDrawTime = 0;
        }
    });

    if (!visible) return null;

    return (
        <>
            <Stats />
            <Html fullscreen style={{ pointerEvents: 'none', zIndex: 1000 }}>
                <div style={{
                    position: 'absolute',
                    top: '60px',
                    left: '5px',
                    background: 'rgba(0, 0, 0, 0.7)',
                    color: '#0f0',
                    padding: '8px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    borderRadius: '4px',
                    border: '1px solid #0f0'
                }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>WebGL Stats</div>
                    <div>Calls: {glStats.calls}</div>
                    <div>Tris: {glStats.triangles.toLocaleString()}</div>
                    <div>Geoms: {glStats.geometries}</div>
                    <div>Tex: {glStats.textures}</div>
                    <div>Progs: {glStats.programs}</div>
                    <div>Ents: {glStats.entities}</div>
                </div>
            </Html>
        </>
    );
};
