import * as THREE from 'three';
import { BlockType } from '../types';

const TEX_SIZE = 64;
const LAYERS = 16;

// Layer Indices
export const TEX_BEDROCK = 0;
export const TEX_STONE = 1;
export const TEX_DIRT = 2;
export const TEX_GRASS_TOP = 3;
export const TEX_GRASS_SIDE = 4;
export const TEX_SAND = 5;
export const TEX_SNOW = 6;
export const TEX_WATER = 7;
export const TEX_WOOD_SIDE = 8;
export const TEX_WOOD_TOP = 9;
export const TEX_LEAF = 10;
export const TEX_GLASS = 11;

export const createBlockTextureArray = () => {
  const size = TEX_SIZE * TEX_SIZE * 4 * LAYERS;
  const data = new Uint8Array(size);

  const fill = (layer: number, r: number, g: number, b: number, noiseStrength: number = 20) => {
    const offset = layer * TEX_SIZE * TEX_SIZE * 4;
    for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
        const n = (Math.random() - 0.5) * noiseStrength;
        data[offset + i * 4] = Math.max(0, Math.min(255, r + n));
        data[offset + i * 4 + 1] = Math.max(0, Math.min(255, g + n));
        data[offset + i * 4 + 2] = Math.max(0, Math.min(255, b + n));
        data[offset + i * 4 + 3] = 255;
    }
  };

  // Bedrock (Dark Grey)
  fill(TEX_BEDROCK, 30, 30, 30, 40);

  // Stone (Grey)
  fill(TEX_STONE, 100, 100, 105, 30);

  // Dirt (Brown)
  fill(TEX_DIRT, 80, 55, 40, 25);

  // Grass Top (Green)
  fill(TEX_GRASS_TOP, 50, 120, 40, 30);

  // Grass Side (Gradient: Green top, Dirt bottom)
  {
      const layer = TEX_GRASS_SIDE;
      const offset = layer * TEX_SIZE * TEX_SIZE * 4;
      for (let y = 0; y < TEX_SIZE; y++) {
          for (let x = 0; x < TEX_SIZE; x++) {
              const idx = (y * TEX_SIZE + x) * 4;
              const n = (Math.random() - 0.5) * 20;
              // Flip Y for texture coords if needed, but here simple
              // Top 1/4 is grass
              if (y > TEX_SIZE * 0.75) {
                   data[offset + idx] = 50 + n;
                   data[offset + idx + 1] = 120 + n;
                   data[offset + idx + 2] = 40 + n;
              } else {
                   data[offset + idx] = 80 + n;
                   data[offset + idx + 1] = 55 + n;
                   data[offset + idx + 2] = 40 + n;
              }
              data[offset + idx + 3] = 255;
          }
      }
  }

  // Sand (Yellowish)
  fill(TEX_SAND, 210, 200, 150, 20);

  // Snow (White)
  fill(TEX_SNOW, 240, 240, 250, 10);

  // Water (Blue + Transparent)
  {
      const layer = TEX_WATER;
      const offset = layer * TEX_SIZE * TEX_SIZE * 4;
      for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
           data[offset + i*4] = 50;
           data[offset + i*4 + 1] = 100;
           data[offset + i*4 + 2] = 200;
           data[offset + i*4 + 3] = 180; // Translucent
      }
  }

  // Wood
  fill(TEX_WOOD_SIDE, 90, 60, 30, 30); // Stripes? simpler for now
  fill(TEX_WOOD_TOP, 110, 80, 50, 30);

  // Leaf
  fill(TEX_LEAF, 30, 90, 30, 40);

  const texture = new THREE.DataArrayTexture(data, TEX_SIZE, TEX_SIZE, LAYERS);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  return texture;
};

// Simple lookup based on normals
export const getTextureIndex = (block: BlockType, normal: {x:number, y:number, z:number}): number => {
    switch (block) {
        case BlockType.BEDROCK: return TEX_BEDROCK;
        case BlockType.STONE: return TEX_STONE;
        case BlockType.DIRT: return TEX_DIRT;
        case BlockType.GRASS:
            if (normal.y > 0.5) return TEX_GRASS_TOP;
            if (normal.y < -0.5) return TEX_DIRT; // Bottom is dirt
            return TEX_GRASS_SIDE;
        case BlockType.SAND: return TEX_SAND;
        case BlockType.SNOW: return TEX_SNOW;
        case BlockType.WATER: return TEX_WATER;
        case BlockType.WOOD:
            if (Math.abs(normal.y) > 0.5) return TEX_WOOD_TOP;
            return TEX_WOOD_SIDE;
        case BlockType.LEAF: return TEX_LEAF;
        default: return TEX_STONE;
    }
};
