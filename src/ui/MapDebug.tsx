import React, { useEffect, useRef, useState } from 'react';
import { BiomeManager, BiomeType } from '@/features/terrain/logic/BiomeManager';

const BIOME_COLORS: Record<BiomeType, string> = {
    PLAINS: '#7cfc00',    // Lawn Green
    DESERT: '#f4a460',    // Sandy Brown
    SNOW: '#ffffff',      // White
    MOUNTAINS: '#808080', // Gray
    JUNGLE: '#228b22',    // Forest Green
    SAVANNA: '#bdb76b',   // Dark Khaki
    ICE_SPIKES: '#00ffff', // Cyan
    RED_DESERT: '#d2691e', // Chocolate
    SKY_ISLANDS: '#8fbc8f',// Dark Sea Green
    THE_GROVE: '#006400',  // Dark Green
    BEACH: '#f4dc81',      // Sandy Beach
};

export const MapDebug: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [scale, setScale] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetZ, setOffsetZ] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });

    const renderMap = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;

        // Center of screen is (0,0) world space initially
        // Pixel (px, py) maps to world (wx, wz)
        // wx = (px - width/2) * scale + offsetX

        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const wx = (px - width / 2) * scale + offsetX;
                const wz = (py - height / 2) * scale + offsetZ;

                // 1. Biome Map
                // const temp = BiomeManager['getClimate'](wx, wz).temp; 
                // We need to access getClimate, but it might be private. 
                // BiomeManager.getBiomeAt is public.
                const biome = BiomeManager.getBiomeAt(wx, wz);
                const colorHex = BIOME_COLORS[biome] || '#ff00ff';

                // Parse hex
                const r = parseInt(colorHex.slice(1, 3), 16);
                const g = parseInt(colorHex.slice(3, 5), 16);
                const b = parseInt(colorHex.slice(5, 7), 16);

                // Height shading overlay
                // const h = TerrainService.getHeightAt(wx, wz);
                // Normalize h approx -20 to 100
                // const brightness = Math.max(0.5, Math.min(1.5, (h + 20) / 80)); 

                const idx = (px + py * width) * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
    };

    useEffect(() => {
        renderMap();
    }, [scale, offsetX, offsetZ]);

    const handleWheel = (e: React.WheelEvent) => {
        // Zoom
        const zoomSpeed = 0.1;
        const newScale = e.deltaY > 0 ? scale * (1 + zoomSpeed) : scale / (1 + zoomSpeed);
        setScale(newScale);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setLastMouse({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - lastMouse.x;
        const dy = e.clientY - lastMouse.y;
        setLastMouse({ x: e.clientX, y: e.clientY });

        // Pan opposite to drag
        setOffsetX(offsetX - dx * scale);
        setOffsetZ(offsetZ - dy * scale);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    return (
        <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-white">
            <div className="absolute top-4 left-4 bg-black/50 p-4 rounded z-10">
                <h1 className="text-xl font-bold">World Map Debug</h1>
                <p>Scale: {scale.toFixed(2)} (Meters per Pixel)</p>
                <p>Center: {offsetX.toFixed(0)}, {offsetZ.toFixed(0)}</p>
                <p className="text-xs text-gray-300">Drag to Pan, Scroll to Zoom</p>
            </div>
            <canvas
                ref={canvasRef}
                width={800}
                height={600}
                className="border border-gray-700 cursor-move"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />
        </div>
    );
};
