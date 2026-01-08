/**
 * Audio System Types
 *
 * Centralized type definitions for the VoxelCraft audio system.
 * All audio playback goes through AudioManager to prevent duplications.
 */

import type { Vector3 } from 'three';

/**
 * Sound categories for volume control and organization
 */
export enum SoundCategory {
  SFX_IMPACT = 'sfx_impact',    // Rock hits, tool impacts
  SFX_DIG = 'sfx_dig',           // Terrain digging
  SFX_CHOP = 'sfx_chop',         // Tree chopping
  SFX_INTERACT = 'sfx_interact', // Pickup, crafting, inventory
  AMBIENT = 'ambient',           // Fire loop, wind, cave ambience
  UI = 'ui',                     // Menu clicks, notifications
  MUSIC = 'music'                // Background music (future)
}

/**
 * Sound definition for registration in the AudioManager
 */
export interface SoundDefinition {
  id: string;                    // Unique identifier (e.g., 'rock_hit')
  url: string;                   // Asset path
  category: SoundCategory;
  baseVolume: number;            // 0.0 - 1.0
  pitchVariation: number;        // Max pitch variance (e.g., 0.1 = ±10%)
  poolSize: number;              // Number of instances for overlapping playback
  loop?: boolean;                // For ambient sounds
  spatial?: boolean;             // Enable 3D positioning (future enhancement)
}

/**
 * Options for playing a sound
 */
export interface PlayOptions {
  volume?: number;        // Override base volume (0.0 - 1.0)
  pitch?: number;         // Override pitch (playbackRate, e.g., 1.2 = 20% faster)
  delay?: number;         // Delay in milliseconds before playing
  fadeIn?: number;        // Fade in duration in milliseconds
  position?: Vector3;     // 3D position for spatial audio (future)
}

/**
 * Custom event detail for vc-audio-play event
 */
export interface AudioPlayEventDetail {
  soundId: string;
  options?: PlayOptions;
}

/**
 * Custom event detail for vc-audio-stop event
 */
export interface AudioStopEventDetail {
  soundId: string;
  fadeOut?: number;       // Fade out duration in milliseconds
}

/**
 * Custom event detail for ambient audio zones
 */
export interface AudioAmbientEventDetail {
  soundId: string;
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Internal audio pool instance
 */
export interface AudioInstance {
  audio: HTMLAudioElement;
  inUse: boolean;
  fadeTimeout?: number;
}

/**
 * Audio pool for a specific sound
 */
export interface AudioPool {
  instances: AudioInstance[];
  currentIndex: number;
  definition: SoundDefinition;
}
