import * as THREE from 'three';

// Channel Mapping must match mesher.ts MATERIAL_CHANNELS
// 0: AIR
// 1: BEDROCK
// 2: STONE
// 3: DIRT
// 4: GRASS
// 5: SAND
// 6: SNOW
// 7: CLAY
// 8: WATER
// 9: MOSSY_STONE
// 10: RED_SAND
// 11: TERRACOTTA
// 12: ICE
// 13: JUNGLE_GRASS
// 14: GLOW_STONE
// 15: OBSIDIAN

const COLORS = [
    '#000000', // 0: AIR (Unused)
    '#2a2a2a', // 1: BEDROCK
    '#888c8d', // 2: STONE
    '#755339', // 3: DIRT
    '#41a024', // 4: GRASS
    '#ebd89f', // 5: SAND
    '#ffffff', // 6: SNOW
    '#a67b5b', // 7: CLAY
    '#0099ff', // 8: WATER (Rendered separately, but kept for alignment)
    '#5c8a3c', // 9: MOSSY_STONE
    '#d45d35', // 10: RED_SAND
    '#9e6b52', // 11: TERRACOTTA
    '#a3d9ff', // 12: ICE
    '#2e8b1d', // 13: JUNGLE_GRASS
    '#ffcc00', // 14: GLOW_STONE
    '#1a1024'  // 15: OBSIDIAN
];

let cachedPalette: THREE.DataArrayTexture | null = null;

export function getPaletteTexture(): THREE.DataArrayTexture {
    if (cachedPalette) return cachedPalette;

    const width = 1;
    const height = 1;
    const depth = 16;

    const size = width * height * depth * 4; // RGBA
    const data = new Uint8Array(size);

    COLORS.forEach((hex, i) => {
        const color = new THREE.Color(hex);
        const idx = i * 4;
        data[idx] = Math.floor(color.r * 255);
        data[idx + 1] = Math.floor(color.g * 255);
        data[idx + 2] = Math.floor(color.b * 255);
        data[idx + 3] = 255; // Alpha
    });

    // NOTE: In older Three.js types/versions this might be DataTexture2DArray,
    // but typically it is DataArrayTexture.
    const texture = new THREE.DataArrayTexture(data, width, height, depth);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // No mipmaps for 1x1 texture
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    cachedPalette = texture;
    return texture;
}
