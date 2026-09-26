import * as THREE from 'three';

/**
 * OrbitConfig
 * Shared parameters for the procedural sun/moon orbit.
 *
 * NOTE:
 * - `offset` is an additive angle (radians) applied to time; it is used for debug time scrubbing.
 * - The moon is typically `Math.PI` radians opposite the sun.
 */
export type OrbitConfig = {
  radius: number;
  speed: number;
  offset: number;
};

/** Share of the full cycle with the sun above the horizon (rest is dusk-night-dawn). */
export const DAY_FRACTION = 0.78;
/** Cycle phase at t = 0: a fraction of the way into the day, so worlds open in mid-morning. */
export const START_PHASE = DAY_FRACTION * 0.17;
/**
 * Tilt of the sun's path away from the zenith (like a mid latitude): noon
 * elevation is 90° minus this. A path through the zenith lit everything from
 * straight above at midday, which flattened the terrain.
 */
export const ORBIT_TILT = 0.6; // ~34°, noon sun at ~56°

/**
 * Calculates the non-linear orbit angle for sun/moon so the day is long and the night short.
 * Linear time maps to angle piecewise: the sun sweeps its above-horizon arc
 * (angle -PI/2..PI/2, where cos(angle) > 0) during DAY_FRACTION of the cycle and the
 * night arc (PI/2..3PI/2) during the rest. Rate is constant within each half and
 * symmetric about noon (the old mapping ran morning and afternoon at different speeds).
 *
 * IMPORTANT:
 * This is intentionally a pure math helper so all systems (lighting, sky gradient)
 * stay in sync without duplicating orbit logic.
 *
 * @param t - Elapsed time in seconds
 * @param speed - Base orbit speed (radians of cycle per second; period = 2PI / speed)
 * @param offset - Optional angle offset (e.g., Math.PI for moon to stay opposite sun)
 * @returns The calculated orbit angle
 */
export const calculateOrbitAngle = (t: number, speed: number, offset: number = 0): number => {
  const cycles = (t * speed) / (Math.PI * 2) + START_PHASE;
  const whole = Math.floor(cycles);
  const phase = cycles - whole; // 0..1

  const angle = phase < DAY_FRACTION
    ? -Math.PI / 2 + (phase / DAY_FRACTION) * Math.PI
    : Math.PI / 2 + ((phase - DAY_FRACTION) / (1 - DAY_FRACTION)) * Math.PI;

  return angle + whole * Math.PI * 2 + offset;
};

/**
 * Computes an orbit offset vector in a vertical plane (local X/Y) with an optional yaw.
 * This keeps the orbit "physically" consistent (sun rises/sets in one plane) while allowing
 * a stable world-facing direction (shadows can have a consistent azimuth).
 *
 * - `angle` controls elevation over time (via sin/cos).
 * - `radius` controls distance for light/shadow rig vs visual disc distance.
 * - `planeOffsetZ` keeps the body slightly in front to avoid clipping artifacts.
 */
export const getOrbitOffset = (
  out: THREE.Vector3,
  angle: number,
  radius: number,
  planeYaw: number = 0,
  planeOffsetZ: number = 30
): THREE.Vector3 => {
  // Local orbit in X/Y with a small forward offset in local Z.
  const lx = Math.sin(angle) * radius;
  const up = Math.cos(angle) * radius;
  const ly = up * Math.cos(ORBIT_TILT);
  const lz = planeOffsetZ + up * Math.sin(ORBIT_TILT);

  // Yaw the orbit plane around world up so the sun/moon arc can be oriented.
  const c = Math.cos(planeYaw);
  const s = Math.sin(planeYaw);
  const wx = lx * c + lz * s;
  const wz = -lx * s + lz * c;

  out.set(wx, ly, wz);
  return out;
};

