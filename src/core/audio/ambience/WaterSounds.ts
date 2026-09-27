/**
 * Synthesised water sounds for the player's body in water (no samples).
 *
 * Real splashes are mostly two things: a broadband slap as something breaks
 * the surface, and a cloud of small air bubbles, each ringing as a short sine
 * whose pitch rises as the bubble shrinks and surfaces (Minnaert resonance:
 * small bubbles high, big ones low). Around those sit a low "gloop" of the
 * displaced water, the swish of a limb dragging through it, and droplets
 * falling back. Each kind below mixes those parts:
 *
 * - wade:   a stride through shallow water (depth 0 = ankle .. 1 = waist):
 *           shallower is lighter and splashier, deeper is heavier and draggier;
 * - stroke: a swimming arm stroke at the surface (alternating sides);
 * - tread:  treading water, a soft slosh;
 * - under:  moving underwater: a muffled swirl and a trail of bubbles;
 * - plunge: falling into water (strength 0..2 with the fall speed).
 */
export type WaterSoundKind = 'wade' | 'stroke' | 'tread' | 'under' | 'plunge';

type Rand = () => number;

export interface WaterVoice {
  ctx: AudioContext;
  /** Dry output (ProceduralAmbience's underwater muffle). */
  out: AudioNode;
  /** Room send (echoes in caves). */
  reverb: AudioNode;
  noise: AudioBuffer;
  rand: Rand;
}

let strokeSide = 1;

export function playWaterSound(v: WaterVoice, kind: WaterSoundKind, depth: number, loudness: number): void {
  const { ctx, noise, rand } = v;
  const t = ctx.currentTime + 0.005;
  const L = Math.max(0.1, Math.min(1.3, loudness));
  const d = Math.max(0, Math.min(1, depth));
  const between = (a: number, b: number) => a + (b - a) * rand();

  const route = (node: AudioNode, pan: number, wet = 0.25) => {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p).connect(v.out);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      p.connect(w).connect(v.reverb);
    }
  };

  /** Filtered noise with a filter sweep and an attack/decay envelope. */
  const wash = (at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, gain: number, attack: number, pan = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = between(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(env);
    route(env, pan);
    src.start(at, rand() * 0.4);
    src.stop(at + dur + 0.05);
  };

  /** One bubble: a sine rising in pitch as it rings down. */
  const bubble = (at: number, f0: number, dur: number, gain: number, pan = 0) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * between(1.5, 2.4), at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(env);
    route(env, pan, 0.15);
    o.start(at);
    o.stop(at + dur + 0.02);
  };

  const bubbles = (count: number, from: number, to: number, fLo: number, fHi: number, gain: number, pan = 0) => {
    for (let i = 0; i < count; i++) {
      // Log-uniform sizes: many small bubbles, a few big ones.
      const f = fLo * Math.pow(fHi / fLo, rand());
      bubble(t + between(from, to), f, between(0.025, 0.07) * (1200 / f) ** 0.3, gain * between(0.5, 1), pan + between(-0.25, 0.25));
    }
  };

  /** A low sine thump (the displaced body of water). */
  const thump = (at: number, f0: number, f1: number, dur: number, gain: number) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(env);
    route(env, 0, 0.3);
    o.start(at);
    o.stop(at + dur + 0.02);
  };

  switch (kind) {
    case 'wade': {
      const pan = between(-0.2, 0.2);
      // Foot breaks the surface: brighter and sharper in the shallows.
      wash(t, 0.05 + 0.06 * d, 'bandpass', 2600 - 1100 * d, 1500 - 600 * d, 0.9, 0.1 * (1 - 0.35 * d) * L, 0.003, pan);
      // The water it pushes aside.
      wash(t + 0.01, 0.2 + 0.2 * d, 'lowpass', 800 - 250 * d, 220, 0.8, 0.1 * (0.45 + d) * L, 0.02, pan);
      thump(t + 0.005, 190 - 60 * d, 80, 0.12, 0.05 * (0.3 + d) * L);
      bubbles(3 + Math.round((3 + 6 * d) * rand()), 0.02, 0.26, 650 - 250 * d, 2600 - 900 * d, 0.03 * L, pan);
      // The leg dragging on through it, longer when deeper.
      wash(t + 0.1 + 0.05 * d, 0.3 + 0.35 * d, 'bandpass', 1500 - 400 * d, 450, 0.8, 0.07 * (0.35 + d) * L, 0.09, pan);
      // Drips from the lifted foot.
      bubbles(2 + Math.round(3 * rand() * (1 - d * 0.5)), 0.28, 0.55, 2400, 4200, 0.007 * L, pan);
      break;
    }
    case 'stroke': {
      strokeSide = -strokeSide;
      const pan = 0.4 * strokeSide;
      // Hand enters, the pull swirls past, a kick behind, water runs off the arm.
      wash(t, 0.13, 'bandpass', 3000, 1700, 0.7, 0.09 * L, 0.004, pan);
      bubbles(5 + Math.round(5 * rand()), 0.01, 0.3, 500, 2200, 0.025 * L, pan);
      wash(t + 0.08, 0.55, 'lowpass', 950, 280, 1.1, 0.09 * L, 0.14, pan * 0.6);
      wash(t + 0.28, 0.22, 'lowpass', 520, 240, 0.8, 0.028 * L, 0.03, -pan * 0.5);
      bubbles(3 + Math.round(4 * rand()), 0.4, 0.7, 2400, 4500, 0.006 * L, pan);
      break;
    }
    case 'tread': {
      wash(t, 0.45, 'lowpass', 620, 330, 0.9, 0.022 * L, 0.12, between(-0.3, 0.3));
      bubbles(1 + Math.round(2 * rand()), 0.05, 0.4, 400, 900, 0.012 * L);
      break;
    }
    case 'under': {
      // Heard through the underwater muffle: the swirl of the stroke and a bubble trail.
      wash(t, 0.65, 'lowpass', 420, 180, 1.2, 0.07 * L, 0.18, between(-0.3, 0.3));
      bubbles(6 + Math.round(6 * rand()), 0.05, 0.6, 180, 700, 0.03 * L);
      break;
    }
    case 'plunge': {
      const s = Math.max(0.3, Math.min(2, depth)) * L;
      // depth carries the fall strength for a plunge.
      wash(t, 0.07, 'highpass', 900, 700, 0.6, 0.065 * s, 0.002);
      wash(t + 0.005, 0.6, 'bandpass', 1600, 500, 0.7, 0.065 * s, 0.006);
      thump(t, 120, 42, 0.4, 0.07 * s);
      bubbles(16 + Math.round(12 * rand()), 0.03, 0.85, 280, 1900, 0.028 * Math.min(1.4, s));
      // Spray falling back.
      bubbles(10 + Math.round(10 * rand()), 0.35, 1.0, 2200, 5200, 0.008 * Math.min(1.4, s));
      break;
    }
  }
}
