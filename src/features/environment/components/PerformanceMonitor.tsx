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
    const { gl, scene } = useThree();
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
        // Visual Stats Update (every 30 frames) - only when overlay is visible
        if (!visible) return;
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
