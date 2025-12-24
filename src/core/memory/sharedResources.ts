import * as THREE from 'three';
import { createNoiseTexture } from '@core/graphics/textureGenerator';

/**
 * Singleton texture shared across materials to save VRAM.
 * This is a 3D noise texture used for terrain texturing.
 * We use a proxy-like pattern to ensure it's created lazily upon first access,
 * preventing allocation peaks during initial module load.
 */
let noiseTextureInstance: THREE.Data3DTexture | null = null;

export const getNoiseTexture = (): THREE.Data3DTexture => {
  if (!noiseTextureInstance) {
    // console.log('[sharedResources] Initializing shared noise texture...');
    noiseTextureInstance = createNoiseTexture(64);
  }
  return noiseTextureInstance;
};

// export const noiseTexture = getNoiseTexture();
