/**
 * ProceduralAmbience: the world's living soundscape, synthesised with Web Audio.
 *
 * No samples: every layer is generated, so it responds continuously to where the
 * player is and when. Owned by AudioManager (audio stays centralised); driven by
 * AmbienceDirector via setScene() a few times per second.
 *
 * Layers
 *   wind      low rumble + high whistle (altitude, exposure), random-walk gusts
 *   leaves    rustle from the nearest real trees (positioned 3D emitters with
 *             distance falloff, each gusting on its own) over a faint bed that
 *             scales with how many trees are nearby
 *   water     river babble / sea swell by proximity
 *   birds     scheduled calls from several synthesised "species" (day, dawn chorus)
 *   insects   crickets (night), cicadas (hot days)
 *   cave      drone + water drips through a long reverb (underground)
 *   night     occasional owl hoots
 * Everything passes a master low-pass that closes when the camera is underwater.
 */

import { GroveMusic, type MusicCue } from './GroveMusic';

export interface AmbienceScene {
  /** 0..1 sun height factor: 0 = night, 1 = full day. */
  daylight: number;
  /** 0..1, peaks around sunrise. */
  dawn: number;
  /** 0 open air .. 1 deep underground. */
  underground: number;
  /** 0..1 camera below the water surface. */
  underwater: number;
  /** 0..1 how many trees surround the player (drives the faint leaf bed and cicadas). */
  foliage: number;
  /** 0..1 bird population of the biome. */
  birdLife: number;
  /** 0..1 heat (cicadas), 0 = cold. */
  heat: number;
  /** 0..1 nearby moving water (rivers, shore). */
  water: number;
  /** true when the nearby water is the open sea (slow swell instead of babble). */
  sea: boolean;
  /** 0..1 exposure to wind (altitude, open terrain). */
  exposure: number;
}

const DEFAULT_SCENE: AmbienceScene = {
  daylight: 1, dawn: 0, underground: 0, underwater: 0, foliage: 0.5,
  birdLife: 0.6, heat: 0.3, water: 0, sea: false, exposure: 0.4,
};

type Rand = () => number;

/** A tree the leaf emitters can attach to (world position of the crown, rustle strength 0..1). */
export interface LeafSource {
  x: number;
  y: number;
  z: number;
  strength: number;
}

export type FootstepSurface = 'grass' | 'dirt' | 'sand' | 'stone' | 'snow' | 'water';

interface StepVoice {
  filter: BiquadFilterType;
  freq: number;
  q: number;
  dur: number;
  level: number;
  /** Low body thump (Hz, 0 = none). */
  thump: number;
  /** Extra grain bursts (snow crunch, gravel). */
  grains: number;
}

const STEP_VOICES: Record<FootstepSurface, StepVoice> = {
  grass: { filter: 'bandpass', freq: 2600, q: 0.7, dur: 0.14, level: 0.05, thump: 90, grains: 0 },
  dirt: { filter: 'bandpass', freq: 950, q: 0.9, dur: 0.1, level: 0.06, thump: 110, grains: 1 },
  sand: { filter: 'lowpass', freq: 1700, q: 0.5, dur: 0.17, level: 0.045, thump: 0, grains: 0 },
  stone: { filter: 'bandpass', freq: 1900, q: 1.6, dur: 0.05, level: 0.045, thump: 130, grains: 0 },
  snow: { filter: 'bandpass', freq: 1400, q: 0.6, dur: 0.2, level: 0.05, thump: 0, grains: 3 },
  water: { filter: 'lowpass', freq: 850, q: 0.7, dur: 0.28, level: 0.07, thump: 0, grains: 1 },
};

/** Positioned rustle emitters (nearest trees). */
const LEAF_EMITTERS = 4;

interface LeafEmitter {
  panner: PannerNode;
  level: GainNode;
  /** Key of the tree this emitter is attached to ('' = free). */
  key: string;
  strength: number;
  gust: number;
  gustTarget: number;
}

/** Small seeded PRNG so the soundscape is varied but not allocation-heavy. */
function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A bird "species": call shape parameters. */
interface Species {
  base: number;      // Hz
  spread: number;    // pitch range as a ratio
  notes: [number, number]; // min/max notes per phrase
  noteLen: number;   // seconds
  gap: number;       // seconds between notes
  sweep: number;     // pitch sweep per note (ratio, +up/-down)
  trill: number;     // FM rate (Hz), 0 = pure whistle
  night?: boolean;
}

const SPECIES: Species[] = [
  { base: 3200, spread: 1.35, notes: [3, 7], noteLen: 0.07, gap: 0.05, sweep: 0.25, trill: 0 },   // warbler
  { base: 2400, spread: 1.2, notes: [2, 4], noteLen: 0.22, gap: 0.12, sweep: -0.15, trill: 0 },   // thrush whistle
  { base: 4600, spread: 1.1, notes: [6, 14], noteLen: 0.03, gap: 0.025, sweep: 0.05, trill: 0 },  // finch trill
  { base: 1500, spread: 1.15, notes: [2, 3], noteLen: 0.16, gap: 0.2, sweep: 0.1, trill: 45 },    // dove-ish coo
  { base: 5200, spread: 1.4, notes: [1, 2], noteLen: 0.12, gap: 0.3, sweep: 0.6, trill: 0 },      // high chip
];

/** Output make-up gain: layer levels are authored conservatively (sum < ~0.1). */
const AMBIENCE_GAIN = 3.2;

const OWL: Species = { base: 420, spread: 1.05, notes: [2, 3], noteLen: 0.45, gap: 0.35, sweep: -0.08, trill: 0, night: true };

export class ProceduralAmbience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;

  private windLow!: GainNode;
  private windHigh!: GainNode;
  private windHighFilter!: BiquadFilterNode;
  private rainBed!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private rainLevel = 0;
  private rainSheltered = false;
  private nextRainTapAt = 0;
  private leaves!: GainNode;
  private leafEmitters: LeafEmitter[] = [];
  private water!: GainNode;
  private waterFilter!: BiquadFilterNode;
  private cicadas!: GainNode;
  private caveDrone!: GainNode;

  private scene: AmbienceScene = { ...DEFAULT_SCENE };
  private gust = 0.5;
  private gustTarget = 0.5;
  private seaPhase = 0;
  private nextBirdAt = 0;
  private nextCricketAt = 0;
  private nextDripAt = 0;
  private nextOwlAt = 0;
  private timer: number | null = null;
  private rand: Rand = mulberry32(0x5eed);
  private volume = 0.8;
  private musicVolume = 0.6;
  private stepNoise: AudioBuffer | null = null;
  private music: GroveMusic | null = null;

  /** Creates the audio graph. Must be called from a user gesture (autoplay policy). */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume * AMBIENCE_GAIN;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.15;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.muffle);

    this.stepNoise = this.makeNoise(0.6, 'white');

    // Sparse generative score, on its own volume and a longer, darker room.
    this.music = new GroveMusic(ctx, ctx.destination, this.makeImpulse(6.5, 3.2), mulberry32(0x6c0e));
    this.music.setVolume(this.musicVolume);

    const pink = this.makeNoise(4, 'pink');
    const brown = this.makeNoise(4, 'brown');
    const white = this.makeNoise(2, 'white');

    // Wind low: brown noise, low-pass, slow gusts.
    this.windLow = ctx.createGain();
    this.windLow.gain.value = 0;
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 380;
    this.loop(brown, 0.9).connect(wl).connect(this.windLow).connect(this.muffle);

    // Wind high: pink noise through a resonant band-pass that follows gusts.
    this.windHigh = ctx.createGain();
    this.windHigh.gain.value = 0;
    this.windHighFilter = ctx.createBiquadFilter();
    this.windHighFilter.type = 'bandpass'; this.windHighFilter.frequency.value = 900; this.windHighFilter.Q.value = 2.5;
    this.loop(pink, 1.07).connect(this.windHighFilter).connect(this.windHigh).connect(this.muffle);

    // Rain: a soft hiss of pink noise; under a roof it dulls to a patter.
    this.rainBed = ctx.createGain();
    this.rainBed.gain.value = 0;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass'; this.rainFilter.frequency.value = 3200; this.rainFilter.Q.value = 0.45;
    this.loop(pink, 1.13).connect(this.rainFilter).connect(this.rainBed).connect(this.muffle);

    // Leaves: high-passed white noise with a fast random tremolo. One faint,
    // non-directional bed, plus positioned emitters on the nearest trees.
    const tremNoise = this.makeNoise(2, 'brown', 3000);
    const rustle = (rate: number, out: AudioNode) => {
      const lh = ctx.createBiquadFilter(); lh.type = 'highpass'; lh.frequency.value = 2600;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const tremDepth = ctx.createGain(); tremDepth.gain.value = 0.5;
      this.loop(tremNoise, 0.8 + this.rand() * 0.5).connect(tremDepth).connect(trem.gain);
      this.loop(white, rate).connect(lh).connect(lp).connect(trem).connect(out);
    };
    this.leaves = ctx.createGain();
    this.leaves.gain.value = 0;
    rustle(0.93, this.leaves);
    this.leaves.connect(this.muffle);
    for (let i = 0; i < LEAF_EMITTERS; i++) {
      const level = ctx.createGain();
      level.gain.value = 0;
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.rolloffFactor = 1.4;
      panner.maxDistance = 60;
      rustle(0.85 + i * 0.07, level);
      level.connect(panner).connect(this.muffle);
      this.leafEmitters.push({ panner, level, key: '', strength: 0, gust: 0.5, gustTarget: 0.5 });
    }

    // Water: band-limited noise; the band wobbles for a babbling character.
    this.water = ctx.createGain();
    this.water.gain.value = 0;
    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'bandpass'; this.waterFilter.frequency.value = 700; this.waterFilter.Q.value = 0.7;
    const wobble = ctx.createOscillator(); wobble.frequency.value = 0.35;
    const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 260;
    wobble.connect(wobbleDepth).connect(this.waterFilter.frequency); wobble.start();
    this.loop(pink, 0.97).connect(this.waterFilter).connect(this.water).connect(this.muffle);
    this.water.connect(this.reverbSend);

    // Cicadas: a narrow noise band with fast amplitude modulation.
    this.cicadas = ctx.createGain();
    this.cicadas.gain.value = 0;
    const cb = ctx.createBiquadFilter(); cb.type = 'bandpass'; cb.frequency.value = 5200; cb.Q.value = 6;
    const cAm = ctx.createGain(); cAm.gain.value = 0.5;
    const cLfo = ctx.createOscillator(); cLfo.type = 'square'; cLfo.frequency.value = 42;
    const cLfoDepth = ctx.createGain(); cLfoDepth.gain.value = 0.5;
    cLfo.connect(cLfoDepth).connect(cAm.gain); cLfo.start();
    this.loop(white, 1.01).connect(cb).connect(cAm).connect(this.cicadas).connect(this.muffle);

    // Cave drone: two detuned low sines, low-passed, into the reverb.
    this.caveDrone = ctx.createGain();
    this.caveDrone.gain.value = 0;
    const d1 = ctx.createOscillator(); d1.frequency.value = 55;
    const d2 = ctx.createOscillator(); d2.frequency.value = 82.7;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 220;
    d1.connect(dl); d2.connect(dl); d1.start(); d2.start();
    dl.connect(this.caveDrone);
    this.caveDrone.connect(this.muffle);
    this.caveDrone.connect(this.reverbSend);

    const now = ctx.currentTime;
    this.nextBirdAt = now + 1;
    this.nextCricketAt = now + 0.5;
    this.nextDripAt = now + 2;
    this.nextOwlAt = now + 20;

    // Scheduler: 10 Hz is plenty for events scheduled ~0.2 s ahead.
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume * AMBIENCE_GAIN, this.ctx.currentTime, 0.2);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    this.music?.setVolume(this.musicVolume);
  }

  /** One synthesised footstep for the surface underfoot (loudness 0..1 ~ speed). */
  footstep(surface: FootstepSurface, loudness: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.stepNoise) return;
    const v = STEP_VOICES[surface];
    const t = ctx.currentTime + 0.005;
    const level = v.level * Math.max(0.2, Math.min(1, loudness)) * (0.8 + 0.4 * this.rand());
    const burst = (at: number, dur: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.stepNoise;
      src.playbackRate.value = 0.85 + this.rand() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = v.filter;
      f.frequency.value = v.freq * (0.85 + this.rand() * 0.3);
      f.Q.value = v.q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(gain, at + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(f).connect(env).connect(this.muffle);
      src.start(at, this.rand() * 0.4);
      src.stop(at + dur + 0.05);
    };
    burst(t, v.dur, level);
    for (let g = 0; g < v.grains; g++) burst(t + 0.02 + this.rand() * v.dur * 0.7, 0.03 + this.rand() * 0.03, level * 0.6);
    if (v.thump > 0) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(v.thump * 1.3, t);
      o.frequency.exponentialRampToValueAtTime(v.thump * 0.7, t + 0.08);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(level * 0.8, t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(env).connect(this.muffle);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  /** Short musical motif for a discovery or milestone. */
  cueMusic(kind: MusicCue): void {
    this.music?.cue(kind);
  }

  /** Moves the listener to the camera (call every frame; cheap). */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /**
   * Attaches the rustle emitters to these trees (nearest first, at most
   * LEAF_EMITTERS used). Emitters keep their tree while it stays in the list;
   * a newly attached emitter fades in from silence so nothing jumps.
   */
  setLeafSources(sources: LeafSource[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const wanted = new Map<string, LeafSource>();
    for (const src of sources.slice(0, LEAF_EMITTERS)) wanted.set(`${Math.round(src.x)},${Math.round(src.z)}`, src);
    // Keep emitters whose tree is still wanted; free the rest.
    for (const e of this.leafEmitters) {
      if (e.key && wanted.has(e.key)) wanted.delete(e.key);
      else if (e.key) { e.key = ''; e.strength = 0; }
    }
    const t = ctx.currentTime;
    for (const e of this.leafEmitters) {
      if (e.key) continue;
      const next = wanted.entries().next();
      if (next.done) break;
      const [key, src] = next.value;
      wanted.delete(key);
      e.key = key;
      e.strength = src.strength;
      e.level.gain.cancelScheduledValues(t);
      e.level.gain.setValueAtTime(0, t);
      e.panner.positionX.setValueAtTime(src.x, t);
      e.panner.positionY.setValueAtTime(src.y, t);
      e.panner.positionZ.setValueAtTime(src.z, t);
    }
  }

  setScene(scene: Partial<AmbienceScene>): void {
    if (this.locked) return;
    Object.assign(this.scene, scene);
  }

  /**
   * Title-screen mood: a still night glade (soft wind, distant crickets and
   * owls, the sparse score). Off hands the scene back to AmbienceDirector.
   */
  setMenuMood(on: boolean): void {
    if (on) this.debugLockScene({ daylight: 0.02, dawn: 0, underground: 0, underwater: 0, foliage: 0.7, birdLife: 0, heat: 0.15, water: 0.12, sea: false, exposure: 0.2 });
    else if (this.locked) this.debugLockScene(null);
  }

  // --- Debug (window.__audioManager.ambience) -------------------------------
  private locked = false;

  /** Pins the scene (ignores AmbienceDirector) for auditioning; null releases. */
  debugLockScene(scene: Partial<AmbienceScene> | null): void {
    this.locked = false;
    if (scene) { this.setScene({ ...DEFAULT_SCENE, ...scene }); this.locked = true; }
  }

  /** Records `seconds` of the mixed output as interleaved stereo PCM. */
  debugCapture(seconds: number): Promise<{ sampleRate: number; left: Float32Array; right: Float32Array }> {
    const ctx = this.ctx;
    if (!ctx) return Promise.reject(new Error('ambience not started'));
    return new Promise((resolve) => {
      const frames = Math.floor(seconds * ctx.sampleRate);
      const left = new Float32Array(frames), right = new Float32Array(frames);
      let at = 0;
      const tap = ctx.createScriptProcessor(4096, 2, 2);
      tap.onaudioprocess = (e) => {
        const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1);
        const n = Math.min(l.length, frames - at);
        left.set(l.subarray(0, n), at); right.set(r.subarray(0, n), at);
        at += n;
        if (at >= frames) { this.master.disconnect(tap); this.music?.output.disconnect(tap); tap.disconnect(); resolve({ sampleRate: ctx.sampleRate, left, right }); }
      };
      this.master.connect(tap);
      this.music?.output.connect(tap);
      tap.connect(ctx.destination); // processors only run when connected
    });
  }

  dispose(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  getStats() {
    return {
      running: this.ctx?.state ?? 'stopped',
      scene: { ...this.scene },
      gust: this.gust,
      leafEmitters: this.leafEmitters.map((e) => ({
        tree: e.key,
        level: +e.level.gain.value.toFixed(4),
        at: [e.panner.positionX.value, e.panner.positionY.value, e.panner.positionZ.value].map((v) => +v.toFixed(1)),
      })),
    };
  }

  // -------------------------------------------------------------------------

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const s = this.scene;
    const outside = 1 - s.underground;
    const tc = 0.6; // smoothing time constant for bed levels

    // Gusts: slow random walk toward new targets.
    if (this.rand() < 0.03) this.gustTarget = 0.25 + this.rand() * 0.75;
    this.gust += (this.gustTarget - this.gust) * 0.04;
    const wind = outside * (0.25 + 0.75 * s.exposure) * (0.4 + 0.6 * this.gust);

    this.windLow.gain.setTargetAtTime(0.09 * wind * (0.4 + s.exposure), t, tc);
    this.windHigh.gain.setTargetAtTime(0.04 * wind * (0.2 + s.exposure), t, tc);
    this.windHighFilter.frequency.setTargetAtTime(600 + 900 * this.gust + 500 * s.exposure, t, 0.8);
    // Leaf bed: faint and non-directional; the nearby trees carry the rustle.
    this.leaves.gain.setTargetAtTime(0.01 * outside * s.foliage * (0.2 + 0.8 * this.gust), t, 0.6);
    for (const e of this.leafEmitters) {
      // Each tree catches the wind on its own schedule, following the overall gusts.
      if (this.rand() < 0.05) e.gustTarget = Math.min(1, Math.max(0, this.gust + (this.rand() - 0.5) * 0.9));
      e.gust += (e.gustTarget - e.gust) * 0.08;
      const level = e.key ? 0.045 * outside * e.strength * (0.12 + 0.88 * e.gust) : 0;
      e.level.gain.setTargetAtTime(level, t, e.key ? 0.5 : 0.3);
    }

    // Water: sea swells slowly, rivers babble steadily.
    this.seaPhase += 0.1 * 0.09 * Math.PI * 2;
    const swell = s.sea ? 0.55 + 0.45 * Math.sin(this.seaPhase) : 1;
    this.water.gain.setTargetAtTime(0.16 * s.water * swell, t, s.sea ? 0.8 : 0.5);
    this.waterFilter.Q.setTargetAtTime(s.sea ? 0.5 : 1.1, t, 1);

    this.cicadas.gain.setTargetAtTime(0.012 * outside * s.heat * s.daylight * s.foliage, t, 1.5);
    this.caveDrone.gain.setTargetAtTime(0.05 * s.underground, t, 1.5);
    this.reverbSend.gain.setTargetAtTime(0.12 + 0.6 * s.underground, t, 1);

    this.music?.update({ daylight: s.daylight, dawn: s.dawn, underground: s.underground, underwater: s.underwater });

    // Underwater: close the master low-pass.
    this.muffle.frequency.setTargetAtTime(s.underwater > 0.5 ? 500 : 18000, t, 0.15);

    // Birds: frequent in the day and the dawn chorus, silent at night and underground.
    const birdRate = outside * s.birdLife * (0.25 * s.daylight + 1.2 * s.dawn); // phrases/s
    if (t >= this.nextBirdAt) {
      if (birdRate > 0.01 && s.underwater < 0.5) {
        const sp = SPECIES[Math.floor(this.rand() * SPECIES.length)];
        this.birdPhrase(sp, t + 0.05, 0.6 + 0.4 * this.rand());
      }
      this.nextBirdAt = t + (birdRate > 0.01 ? (0.4 + this.rand() * 2) / birdRate : 2);
    }

    // Crickets: a few individuals chirping at night.
    const night = 1 - s.daylight;
    if (t >= this.nextCricketAt) {
      if (night > 0.3 && outside > 0.5 && s.underwater < 0.5) this.cricketChirp(t + 0.02, night);
      this.nextCricketAt = t + 0.35 + this.rand() * 0.6;
    }

    // Owls at night.
    if (t >= this.nextOwlAt) {
      if (night > 0.6 && outside > 0.5 && s.foliage > 0.3) this.birdPhrase(OWL, t + 0.05, 0.5);
      this.nextOwlAt = t + 18 + this.rand() * 30;
    }

    // Rain bed and the odd heavier drop; a roof overhead dulls it to a patter.
    const rain = this.rainLevel * outside;
    this.rainBed.gain.setTargetAtTime(0.07 * rain * (this.rainSheltered ? 0.75 : 1), t, 0.8);
    this.rainFilter.frequency.setTargetAtTime(this.rainSheltered ? 1300 : 3200, t, 0.5);
    if (t >= this.nextRainTapAt) {
      if (rain > 0.05 && s.underwater < 0.5) this.rainTap(t + 0.02, rain);
      this.nextRainTapAt = t + (rain > 0.05 ? (0.05 + this.rand() * 0.25) / (0.3 + rain) : 1);
    }

    // Cave drips.
    if (t >= this.nextDripAt) {
      if (s.underground > 0.4) this.drip(t + 0.02);
      this.nextDripAt = t + 0.6 + this.rand() * 3;
    }
  }

  /** One bird phrase: a sequence of swept, optionally trilled sine notes. */
  private birdPhrase(sp: Species, start: number, loudness: number): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.6 - 0.8;
    const dist = 0.3 + this.rand() * 0.7; // farther birds are quieter and duller
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5000 + 9000 * (1 - dist);
    const out = ctx.createGain();
    out.gain.value = (sp.night ? 0.08 : 0.09) * loudness * (1.2 - dist);
    pan.connect(tone).connect(out).connect(this.muffle);
    out.connect(this.reverbSend);

    const pitch = sp.base * (1 + (this.rand() - 0.5) * (sp.spread - 1));
    const notes = sp.notes[0] + Math.floor(this.rand() * (sp.notes[1] - sp.notes[0] + 1));
    let t = start;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = pitch * (1 + (this.rand() - 0.5) * 0.12) * (1 + 0.04 * Math.sin(i));
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, f0 * (1 + sp.sweep)), t + sp.noteLen);
      if (sp.trill > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = sp.trill;
        const depth = ctx.createGain();
        depth.gain.value = f0 * 0.04;
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(t); lfo.stop(t + sp.noteLen + 0.05);
      }
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + Math.min(0.012, sp.noteLen * 0.3));
      env.gain.setTargetAtTime(0, t + sp.noteLen * 0.55, sp.noteLen * 0.25);
      osc.connect(env).connect(pan);
      osc.start(t);
      osc.stop(t + sp.noteLen + 0.2);
      t += sp.noteLen + sp.gap * (0.7 + 0.6 * this.rand());
    }
    // Let the graph be collected after the phrase.
    const end = t + 0.5;
    window.setTimeout(() => { try { out.disconnect(); } catch { /* already gone */ } }, (end - ctx.currentTime) * 1000 + 200);
  }

  /** A cricket chirp: three rapid pulses of a ~4.5 kHz tone. */
  private cricketChirp(start: number, night: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = 4300 + this.rand() * 700;
    const env = ctx.createGain();
    env.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 2 - 1;
    const level = 0.03 * night * (0.4 + 0.6 * this.rand());
    const pulses = 2 + Math.floor(this.rand() * 3);
    for (let i = 0; i < pulses; i++) {
      const p = start + i * 0.045;
      env.gain.setValueAtTime(0, p);
      env.gain.linearRampToValueAtTime(level, p + 0.006);
      env.gain.linearRampToValueAtTime(0, p + 0.03);
    }
    osc.connect(env).connect(pan).connect(this.muffle);
    osc.start(start);
    osc.stop(start + pulses * 0.045 + 0.05);
  }

  /** A water drip: a fast downward-sweeping sine blip into the reverb. */
  /** A single heavier raindrop tapping leaves, ground or a roof. */
  private rainTap(start: number, level: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.stepNoise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = (this.rainSheltered ? 900 : 2400) * (0.7 + this.rand() * 0.6);
    f.Q.value = 2.5;
    const env = ctx.createGain();
    const g = (this.rainSheltered ? 0.05 : 0.025) * level * (0.4 + this.rand() * 0.6);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(g, start + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.6 - 0.8;
    src.connect(f).connect(env).connect(pan).connect(this.muffle);
    src.start(start, this.rand() * 0.3);
    src.stop(start + 0.08);
  }

  /** Rain level (0..1) and whether the player has a roof overhead. */
  setWeather(rain: number, sheltered: boolean): void {
    this.rainLevel = Math.max(0, Math.min(1, rain));
    this.rainSheltered = sheltered;
  }

  /** A fire or torch doused by rain: a steam hiss with a few crackles. */
  hiss(loudness = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.stepNoise) return;
    const t = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = this.stepNoise;
    src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.09 * loudness, t + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    src.connect(hp).connect(env).connect(this.muffle);
    src.start(t);
    src.stop(t + 1.7);
    for (let i = 0; i < 5; i++) this.rainTap(t + 0.05 + this.rand() * 0.8, 1.5 * loudness);
  }

  private drip(start: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const f = 1400 + this.rand() * 1600;
    osc.frequency.setValueAtTime(f, start);
    osc.frequency.exponentialRampToValueAtTime(f * 0.45, start + 0.08);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(0.05, start + 0.004);
    env.gain.setTargetAtTime(0, start + 0.01, 0.03);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rand() * 1.4 - 0.7;
    osc.connect(env).connect(pan);
    pan.connect(this.reverbSend);
    pan.connect(this.muffle);
    osc.start(start);
    osc.stop(start + 0.25);
  }

  // -------------------------------------------------------------------------

  private loop(buffer: AudioBuffer, rate: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    // Random offset so layers sharing a buffer don't correlate.
    src.start(0, this.rand() * buffer.duration);
    return src;
  }

  /** Noise buffer. `brown` is integrated (deep), `pink` uses Kellet's filter. */
  private makeNoise(seconds: number, kind: 'white' | 'pink' | 'brown', sampleRate?: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = sampleRate ?? ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = this.rand() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    // Crossfade the loop seam.
    const fade = Math.min(len >> 3, Math.floor(rate * 0.05));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
    }
    return buf;
  }

  /** Stereo exponentially decaying noise: a cheap natural reverb tail. */
  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (this.rand() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
}
