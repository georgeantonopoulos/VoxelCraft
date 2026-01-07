/**
 * Sound Registry
 *
 * Single source of truth for all sound definitions in VoxelCraft.
 * Each sound is registered with metadata for the AudioManager.
 *
 * Sound Categories:
 * - SFX_DIG: Terrain digging/building
 * - SFX_IMPACT: Rock hits, stone collisions
 * - SFX_CHOP: Tree chopping, wood impacts
 * - SFX_INTERACT: Pickups, crafting, inventory
 * - AMBIENT: Looping environmental sounds (fire, wind)
 * - UI: Menu clicks, notifications
 * - MUSIC: Background music (future)
 */

import { SoundCategory, type SoundDefinition } from './types';

// Import sound files
import dig1Url from '@/assets/sounds/Dig_1.wav?url';
import dig2Url from '@/assets/sounds/Dig_2.wav?url';
import dig3Url from '@/assets/sounds/Dig_3.wav?url';
import clunkUrl from '@/assets/sounds/clunk.wav?url';
import stoneHitUrl from '@/assets/sounds/stone_hit.mp3?url';
import fireUrl from '@/assets/sounds/fire.mp3?url';
import pickaxeDigUrl from '@/assets/sounds/pickaxe_dig.wav?url';

/**
 * Complete sound registry for AudioManager initialization
 */
export const SOUND_REGISTRY: SoundDefinition[] = [
  // === DIGGING SOUNDS ===
  // Three variations for variety in terrain digging
  {
    id: 'dig_1',
    url: dig1Url,
    category: SoundCategory.SFX_DIG,
    baseVolume: 0.3,
    pitchVariation: 0.1,  // ±10% pitch variation
    poolSize: 4
  },
  {
    id: 'dig_2',
    url: dig2Url,
    category: SoundCategory.SFX_DIG,
    baseVolume: 0.3,
    pitchVariation: 0.1,
    poolSize: 4
  },
  {
    id: 'dig_3',
    url: dig3Url,
    category: SoundCategory.SFX_DIG,
    baseVolume: 0.3,
    pitchVariation: 0.1,
    poolSize: 4
  },

  // Specialized pickaxe digging (more aggressive)
  {
    id: 'pickaxe_dig',
    url: pickaxeDigUrl,
    category: SoundCategory.SFX_DIG,
    baseVolume: 0.35,
    pitchVariation: 0.08,
    poolSize: 4
  },

  // === IMPACT SOUNDS ===
  // Rock-on-rock impacts (NEW: stone_hit.mp3)
  {
    id: 'rock_hit',
    url: stoneHitUrl,
    category: SoundCategory.SFX_IMPACT,
    baseVolume: 0.45,
    pitchVariation: 0.15,  // More variation for natural feel
    poolSize: 6             // Higher pool size for rapid hits
  },

  // === CHOPPING SOUNDS ===
  // Wood/tree impacts (using original clunk.wav)
  {
    id: 'wood_hit',
    url: clunkUrl,
    category: SoundCategory.SFX_CHOP,
    baseVolume: 0.4,
    pitchVariation: 0.1,
    poolSize: 4
  },

  // Generic clunk for miscellaneous impacts
  {
    id: 'clunk',
    url: clunkUrl,
    category: SoundCategory.SFX_IMPACT,
    baseVolume: 0.4,
    pitchVariation: 0.1,
    poolSize: 4
  },

  // === AMBIENT SOUNDS ===
  // Fire loop (NEW: fire.mp3)
  {
    id: 'fire_loop',
    url: fireUrl,
    category: SoundCategory.AMBIENT,
    baseVolume: 0.25,
    pitchVariation: 0,      // No pitch variation for ambient loops
    poolSize: 1,            // Only need one instance for looping
    loop: true
  },

  // === INTERACTION SOUNDS (Future) ===
  // These IDs are reserved for future implementation:
  // - 'pickup_item' - Item pickup from ground
  // - 'craft_complete' - Crafting completion
  // - 'inventory_move' - Inventory item movement
  // - 'torch_ignite' - Torch placement/ignition

  // === CREATURE SOUNDS (Future) ===
  // These IDs are reserved for Lumabee character implementation:
  // - 'bee_buzz' - Ambient bee buzzing (loop)
  // - 'bee_harvest' - Nectar extraction sound
  // - 'bee_flee' - Bee fleeing sound
  //
  // Placeholder entries (will error if actually played without sound files):
  // {
  //   id: 'bee_buzz',
  //   url: '/src/assets/sounds/bee_buzz.mp3',
  //   category: SoundCategory.AMBIENT,
  //   baseVolume: 0.15,
  //   pitchVariation: 0.05,
  //   poolSize: 10,
  //   loop: true
  // },
  // {
  //   id: 'bee_harvest',
  //   url: '/src/assets/sounds/bee_harvest.mp3',
  //   category: SoundCategory.SFX_INTERACT,
  //   baseVolume: 0.25,
  //   pitchVariation: 0.1,
  //   poolSize: 4
  // },
];

/**
 * Helper to get random dig sound ID
 */
export function getRandomDigSound(): string {
  const digSounds = ['dig_1', 'dig_2', 'dig_3'];
  return digSounds[Math.floor(Math.random() * digSounds.length)];
}

/**
 * Helper to check if a sound is registered
 */
export function isSoundRegistered(soundId: string): boolean {
  return SOUND_REGISTRY.some(def => def.id === soundId);
}
