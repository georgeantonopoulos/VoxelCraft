/**
 * AudioManager - Centralized Audio System
 *
 * Single source of truth for all audio playback in VoxelCraft.
 * Prevents duplicate sound triggers and manages audio pooling.
 *
 * Architecture:
 * - Singleton pattern: one global instance
 * - Pool-based: each sound has multiple instances for overlapping playback
 * - Event-driven: listens to vc-audio-* custom events
 * - Category-based volume control: SFX, Ambient, UI, Music
 *
 * Usage:
 *   // Dispatch event from anywhere in the codebase
 *   window.dispatchEvent(new CustomEvent('vc-audio-play', {
 *     detail: { soundId: 'rock_hit', options: { pitch: 1.2 } }
 *   }));
 */

import { SoundCategory } from './types';
import type {
  SoundDefinition,
  PlayOptions,
  AudioPool,
  AudioInstance,
  AudioPlayEventDetail,
  AudioStopEventDetail,
  AudioAmbientEventDetail
} from './types';

export class AudioManager {
  private static instance: AudioManager | null = null;

  // Audio pools by sound ID
  private pools: Map<string, AudioPool> = new Map();

  // Volume controls
  private masterVolume: number = 1.0;
  private categoryVolumes: Map<SoundCategory, number> = new Map();

  // Active looping sounds (ambient)
  private loopingSounds: Map<string, HTMLAudioElement> = new Map();

  // Initialization flag
  private initialized: boolean = false;

  private constructor() {
    // Private constructor for singleton
    this.initializeCategoryVolumes();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /**
   * Initialize category volumes to default (1.0)
   */
  private initializeCategoryVolumes(): void {
    Object.values(SoundCategory).forEach(category => {
      this.categoryVolumes.set(category, 1.0);
    });
  }

  /**
   * Initialize the AudioManager with sound definitions
   * Must be called before any audio playback
   */
  initialize(soundDefinitions: SoundDefinition[]): void {
    if (this.initialized) {
      console.warn('[AudioManager] Already initialized, skipping');
      return;
    }

    // Register all sounds
    soundDefinitions.forEach(def => this.registerSound(def));

    // Setup event listeners
    this.setupEventListeners();

    this.initialized = true;
    console.log(`[AudioManager] Initialized with ${soundDefinitions.length} sounds`);
  }

  /**
   * Register a sound and create its audio pool
   */
  private registerSound(definition: SoundDefinition): void {
    if (this.pools.has(definition.id)) {
      console.warn(`[AudioManager] Sound '${definition.id}' already registered, skipping`);
      return;
    }

    // Create pool instances
    const instances: AudioInstance[] = [];
    for (let i = 0; i < definition.poolSize; i++) {
      const audio = new Audio(definition.url);
      audio.volume = definition.baseVolume * this.masterVolume *
                     (this.categoryVolumes.get(definition.category) ?? 1.0);
      audio.loop = definition.loop ?? false;

      instances.push({ audio, inUse: false });
    }

    this.pools.set(definition.id, {
      instances,
      currentIndex: 0,
      definition
    });
  }

  /**
   * Setup event listeners for audio events
   */
  private setupEventListeners(): void {
    window.addEventListener('vc-audio-play', this.handlePlayEvent.bind(this));
    window.addEventListener('vc-audio-stop', this.handleStopEvent.bind(this));
    window.addEventListener('vc-audio-ambient-enter', this.handleAmbientEnterEvent.bind(this));
    window.addEventListener('vc-audio-ambient-exit', this.handleAmbientExitEvent.bind(this));
  }

  /**
   * Handle vc-audio-play event
   */
  private handlePlayEvent(event: Event): void {
    const customEvent = event as CustomEvent<AudioPlayEventDetail>;
    const { soundId, options } = customEvent.detail;
    this.play(soundId, options);
  }

  /**
   * Handle vc-audio-stop event
   */
  private handleStopEvent(event: Event): void {
    const customEvent = event as CustomEvent<AudioStopEventDetail>;
    const { soundId, fadeOut } = customEvent.detail;
    this.stop(soundId, fadeOut);
  }

  /**
   * Handle vc-audio-ambient-enter event (start looping sound)
   */
  private handleAmbientEnterEvent(event: Event): void {
    const customEvent = event as CustomEvent<AudioAmbientEventDetail>;
    const { soundId, fadeIn } = customEvent.detail;
    this.startAmbient(soundId, fadeIn);
  }

  /**
   * Handle vc-audio-ambient-exit event (stop looping sound)
   */
  private handleAmbientExitEvent(event: Event): void {
    const customEvent = event as CustomEvent<AudioAmbientEventDetail>;
    const { soundId, fadeOut } = customEvent.detail;
    this.stopAmbient(soundId, fadeOut);
  }

  /**
   * Play a sound with optional settings
   */
  play(soundId: string, options?: PlayOptions): void {
    const pool = this.pools.get(soundId);
    if (!pool) {
      console.warn(`[AudioManager] Sound '${soundId}' not registered`);
      return;
    }

    // Get next available instance from pool (round-robin)
    const instance = pool.instances[pool.currentIndex];
    pool.currentIndex = (pool.currentIndex + 1) % pool.instances.length;

    const { audio } = instance;
    const def = pool.definition;

    // Reset audio to start
    audio.currentTime = 0;

    // Apply volume (base * category * master * override)
    const volume = (options?.volume ?? def.baseVolume) *
                   this.masterVolume *
                   (this.categoryVolumes.get(def.category) ?? 1.0);
    audio.volume = Math.max(0, Math.min(1, volume));

    // Apply pitch variation
    if (options?.pitch !== undefined) {
      audio.playbackRate = options.pitch;
    } else if (def.pitchVariation > 0) {
      // Random pitch variation: baseRate ± variation
      const variation = (Math.random() * 2 - 1) * def.pitchVariation;
      audio.playbackRate = 1.0 + variation;
    } else {
      audio.playbackRate = 1.0;
    }

    // Handle delay
    if (options?.delay) {
      setTimeout(() => {
        audio.play().catch(err => {
          console.warn(`[AudioManager] Failed to play '${soundId}':`, err);
        });
      }, options.delay);
    } else {
      audio.play().catch(err => {
        console.warn(`[AudioManager] Failed to play '${soundId}':`, err);
      });
    }

    // TODO: Implement fade in if needed
    if (options?.fadeIn) {
      // Future enhancement: gradual volume increase
    }
  }

  /**
   * Stop a specific sound (mainly for looping sounds)
   */
  stop(soundId: string, fadeOut?: number): void {
    const pool = this.pools.get(soundId);
    if (!pool) return;

    // Stop all instances of this sound
    pool.instances.forEach(instance => {
      if (!instance.audio.paused) {
        if (fadeOut) {
          // TODO: Implement fade out
          instance.audio.pause();
        } else {
          instance.audio.pause();
        }
      }
    });
  }

  /**
   * Start an ambient looping sound (fire, wind, etc.)
   */
  private startAmbient(soundId: string, fadeIn?: number): void {
    // Don't restart if already playing
    if (this.loopingSounds.has(soundId)) {
      return;
    }

    const pool = this.pools.get(soundId);
    if (!pool) {
      console.warn(`[AudioManager] Ambient sound '${soundId}' not registered`);
      return;
    }

    // Use first instance for ambient (looping sounds don't need pooling)
    const instance = pool.instances[0];
    const { audio } = instance;
    const def = pool.definition;

    audio.loop = true;
    audio.currentTime = 0;

    // Apply volume
    const volume = def.baseVolume *
                   this.masterVolume *
                   (this.categoryVolumes.get(def.category) ?? 1.0);
    audio.volume = Math.max(0, Math.min(1, volume));

    audio.play().catch(err => {
      console.warn(`[AudioManager] Failed to start ambient '${soundId}':`, err);
    });

    this.loopingSounds.set(soundId, audio);

    // TODO: Implement fade in
  }

  /**
   * Stop an ambient looping sound
   */
  private stopAmbient(soundId: string, fadeOut?: number): void {
    const audio = this.loopingSounds.get(soundId);
    if (!audio) return;

    if (fadeOut) {
      // TODO: Implement fade out
      audio.pause();
    } else {
      audio.pause();
    }

    this.loopingSounds.delete(soundId);
  }

  /**
   * Set master volume (affects all sounds)
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));

    // Update all active sounds
    this.updateAllVolumes();
  }

  /**
   * Set volume for a specific category
   */
  setCategoryVolume(category: SoundCategory, volume: number): void {
    this.categoryVolumes.set(category, Math.max(0, Math.min(1, volume)));

    // Update all active sounds in this category
    this.updateAllVolumes();
  }

  /**
   * Mute a category (or all if no category specified)
   */
  mute(category?: SoundCategory): void {
    if (category) {
      this.setCategoryVolume(category, 0);
    } else {
      this.setMasterVolume(0);
    }
  }

  /**
   * Update volume for all audio instances
   */
  private updateAllVolumes(): void {
    this.pools.forEach(pool => {
      const baseVolume = pool.definition.baseVolume;
      const categoryVolume = this.categoryVolumes.get(pool.definition.category) ?? 1.0;
      const finalVolume = baseVolume * categoryVolume * this.masterVolume;

      pool.instances.forEach(instance => {
        instance.audio.volume = Math.max(0, Math.min(1, finalVolume));
      });
    });
  }

  /**
   * Cleanup (for hot reload or disposal)
   */
  dispose(): void {
    // Stop all looping sounds
    this.loopingSounds.forEach(audio => audio.pause());
    this.loopingSounds.clear();

    // Clear all pools
    this.pools.clear();

    // Remove event listeners
    window.removeEventListener('vc-audio-play', this.handlePlayEvent.bind(this));
    window.removeEventListener('vc-audio-stop', this.handleStopEvent.bind(this));
    window.removeEventListener('vc-audio-ambient-enter', this.handleAmbientEnterEvent.bind(this));
    window.removeEventListener('vc-audio-ambient-exit', this.handleAmbientExitEvent.bind(this));

    this.initialized = false;
  }

  /**
   * Get debug statistics
   */
  getStats(): {
    totalSounds: number;
    totalInstances: number;
    activeLoops: number;
    categories: string[];
  } {
    let totalInstances = 0;
    this.pools.forEach(pool => {
      totalInstances += pool.instances.length;
    });

    return {
      totalSounds: this.pools.size,
      totalInstances,
      activeLoops: this.loopingSounds.size,
      categories: Array.from(this.categoryVolumes.keys())
    };
  }
}

// Export singleton instance for convenience
export const audioManager = AudioManager.getInstance();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).__audioManager = audioManager;
}
