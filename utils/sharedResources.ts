import { createNoiseTexture } from './textureGenerator';

// Singleton texture shared across materials to save VRAM
export const noiseTexture = createNoiseTexture(64);
