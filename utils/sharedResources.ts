import * as THREE from 'three';
import { createNoiseTexture } from './textureGenerator';

/**
 * Singleton texture shared across materials to save VRAM.
 * This is a 3D noise texture used for terrain texturing.
 */
const noiseTextureInstance: THREE.Data3DTexture = createNoiseTexture(64);

/**
 * Getter function for the shared noise texture.
 * @returns The singleton 3D noise texture instance.
 */
export function getNoiseTexture(): THREE.Data3DTexture {
  return noiseTextureInstance;
}

/**
 * Direct export of the noise texture for backward compatibility.
 */
export const noiseTexture = noiseTextureInstance;
