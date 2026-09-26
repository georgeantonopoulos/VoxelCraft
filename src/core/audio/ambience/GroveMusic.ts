/**
 * GroveMusic: a sparse generative score on the ambience AudioContext.
 *
 * Mostly silence. Every so often a few soft glass notes drift up (a calm
 * pentatonic by day, a darker minor set at night and underground), a slow pad
 * breathes in at dawn, dusk and in caves, and short motifs mark discoveries.
 * Everything goes through a long, dark reverb so notes feel far away.
 */

type Rand = () => number;

export interface MusicMood {
  /** 0 = night, 1 = full day. */
  daylight: number;
  /** 0..1, peaks around sunrise. */
  dawn: number;
  /** 0 open air .. 1 deep underground. */
  underground: number;
  /** 0..1 camera below the water surface. */
  underwater: number;
}

export type MusicCue = 'quest-complete' | 'quest-start' | 'rank-up' | 'discovery' | 'hollow-restored';

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// D-centred sets. Day: D major pentatonic (open, unresolved). Night: D minor
// pentatonic plus a flat sixth for a touch of unease.
const DAY_SET = [50, 57, 62, 64, 66, 69, 71, 74, 76, 78];
const NIGHT_SET = [50, 57, 62, 65, 67, 69, 70, 72, 74, 77];

const MUSIC_GAIN = 0.9;

export class GroveMusic {
  private readonly ctx: AudioContext;
  private readonly rand: Rand;
  private readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly padGain: GainNode;
  private readonly padVoices: OscillatorNode[] = [];
  private readonly padLfo: OscillatorNode;
  private volume = 0.6;
  private mood: MusicMood = { daylight: 1, dawn: 0, underground: 0, underwater: 0 };
  private nextPhraseAt: number;
  private lastIndex = 4;

  constructor(ctx: AudioContext, destination: AudioNode, impulse: AudioBuffer, rand: Rand) {
    this.ctx = ctx;
    this.rand = rand;

    this.out = ctx.createGain();
    this.out.gain.value = this.volume * MUSIC_GAIN;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 5200;
    this.filter.connect(this.out);
    this.out.connect(destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.75;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.35;
    this.wet.connect(reverb).connect(this.filter);
    this.dry.connect(this.filter);

    // Pad: three detuned voices (root, fifth, ninth) breathing slowly.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 700;
    padFilter.Q.value = 0.3;
    const breath = ctx.createGain();
    breath.gain.value = 0.7;
    this.padLfo = ctx.createOscillator();
    this.padLfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    this.padLfo.connect(lfoDepth).connect(breath.gain);
    this.padLfo.start();
    for (const [m, detune] of [[38, -4], [45, 3], [52, -2]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiHz(m);
      o.detune.value = detune;
      o.connect(padFilter);
      o.start();
      this.padVoices.push(o);
    }
    padFilter.connect(breath).connect(this.padGain);
    this.padGain.connect(this.wet);
    this.padGain.connect(this.dry);

    // First phrase comes a little while after the world opens.
    this.nextPhraseAt = ctx.currentTime + 20 + rand() * 15;
  }

  /** Final music node (debug capture taps it alongside the ambience master). */
  get output(): AudioNode { return this.out; }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.out.gain.setTargetAtTime(this.volume * MUSIC_GAIN, this.ctx.currentTime, 0.3);
  }

  /** Called from the ambience tick (10 Hz). */
  update(mood: MusicMood): void {
    this.mood = mood;
    const t = this.ctx.currentTime;
    const night = 1 - mood.daylight;
    const twilight = Math.max(mood.dawn, mood.daylight > 0.1 && mood.daylight < 0.6 ? 0.6 : 0);
    const padLevel = 0.022 * Math.max(twilight, mood.underground * 0.9, night * 0.35);
    this.padGain.gain.setTargetAtTime(padLevel, t, 4);
    // Darker pad at night/underground: drop the ninth a semitone (minor colour).
    const dark = Math.max(night, mood.underground) > 0.5;
    this.padVoices[2].frequency.setTargetAtTime(midiHz(dark ? 53 : 52), t, 3);
    this.filter.frequency.setTargetAtTime(mood.underwater > 0.5 ? 600 : 5200, t, 0.2);

    if (t >= this.nextPhraseAt) {
      if (mood.underwater < 0.5) this.phrase(t + 0.05, dark);
      // Long silences are the point: 15-45 s between phrases.
      this.nextPhraseAt = t + 15 + this.rand() * 30;
    }
  }

  /** Short motif for a moment worth marking. */
  cue(kind: MusicCue): void {
    const t = this.ctx.currentTime + 0.1;
    const dark = Math.max(1 - this.mood.daylight, this.mood.underground) > 0.5;
    const set = dark ? NIGHT_SET : DAY_SET;
    const seqs: Record<MusicCue, number[]> = {
      'quest-start': [4, 6],
      'quest-complete': [2, 4, 7],
      'discovery': [3, 5, 8],
      'rank-up': [2, 4, 6, 9],
      'hollow-restored': [0, 2, 4, 7, 9],
    };
    seqs[kind].forEach((idx, i) => this.note(midiHz(set[idx]), t + i * 0.32, 0.05, 4.5));
    // Keep the next ambient phrase from crowding the motif.
    this.nextPhraseAt = Math.max(this.nextPhraseAt, this.ctx.currentTime + 12);
  }

  private phrase(start: number, dark: boolean): void {
    const set = dark ? NIGHT_SET : DAY_SET;
    const count = 2 + Math.floor(this.rand() * 4);
    let idx = this.lastIndex;
    let t = start;
    for (let i = 0; i < count; i++) {
      // Small random walk, mostly stepwise, staying in the middle register.
      idx = Math.max(1, Math.min(set.length - 1, idx + Math.round((this.rand() - 0.5) * 4)));
      const loud = 0.03 + this.rand() * 0.02;
      this.note(midiHz(set[idx]), t, loud, 3.5 + this.rand() * 2);
      // Occasionally a soft octave-below partner note for depth.
      if (this.rand() < 0.2) this.note(midiHz(set[idx] - 12), t + 0.02, loud * 0.5, 5);
      t += 0.45 + this.rand() * 0.9;
    }
    this.lastIndex = idx;
  }

  /** Glassy bell: sine fundamental plus soft inharmonic partials, fast attack, long tail. */
  private note(freq: number, start: number, level: number, decay: number): void {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(level, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    env.connect(this.wet);
    env.connect(this.dry);
    const partials: Array<[number, number]> = [[1, 1], [2.01, 0.28], [3.98, 0.08]];
    for (const [ratio, amp] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g).connect(env);
      o.start(start);
      o.stop(start + decay + 0.1);
    }
  }
}
