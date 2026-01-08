/**
 * Audio System Entry Point
 *
 * Centralized audio management for VoxelCraft.
 * All audio playback goes through AudioManager to prevent duplications.
 *
 * Usage:
 *   import { audioManager } from '@core/audio';
 *
 *   // Play sound via event
 *   window.dispatchEvent(new CustomEvent('vc-audio-play', {
 *     detail: { soundId: 'rock_hit', options: { pitch: 1.2 } }
 *   }));
 *
 *   // Or directly
 *   audioManager.play('rock_hit', { pitch: 1.2 });
 */

export { AudioManager, audioManager } from './AudioManager';
export { SOUND_REGISTRY, getRandomDigSound, isSoundRegistered } from './soundRegistry';
export * from './types';
