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

/**
 * Calculates the non-linear orbit angle for sun/moon to make day longer and night shorter.
 * Maps linear time progression to angle progression where day (sun above horizon) takes
 * ~70% of the cycle and night takes ~30%.
 *
 * IMPORTANT:
 * This is intentionally a pure math helper so all systems (lighting, sky gradient, IBL)
 * can stay in sync without duplicating orbit logic.
 *
 * @param t - Elapsed time in seconds
 * @param speed - Base orbit speed
 * @param offset - Optional angle offset (e.g., Math.PI for moon to stay opposite sun)
 * @returns The calculated orbit angle
 */
export const calculateOrbitAngle = (t: number, speed: number, offset: number = 0): number => {
  const cycleTime = t * speed;
  const normalizedCycle = (cycleTime % (Math.PI * 2)) / (Math.PI * 2); // 0 to 1

  // Stretch day (when sun is above horizon): spend ~70% of cycle in day, ~30% in night
  // Day corresponds to angles where cos(angle) > 0, i.e., -π/2 to π/2
  let angle: number;
  if (normalizedCycle < 0.35) {
    // First half of day: map 0-0.35 to -π/2 to 0
    angle = -Math.PI / 2 + (normalizedCycle / 0.35) * (Math.PI / 2);
  } else if (normalizedCycle < 0.65) {
    // Second half of day: map 0.35-0.65 to 0 to π/2
    angle = ((normalizedCycle - 0.35) / 0.3) * (Math.PI / 2);
  } else {
    // Night: map 0.65-1.0 to π/2 to 3π/2 (faster through night)
    angle = Math.PI / 2 + ((normalizedCycle - 0.65) / 0.35) * Math.PI;
  }

  // Add full cycle offset
  angle += Math.floor(cycleTime / (Math.PI * 2)) * Math.PI * 2;

  return angle + offset;
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
  const ly = Math.cos(angle) * radius;
  const lz = planeOffsetZ;

  // Yaw the orbit plane around world up so the sun/moon arc can be oriented.
  const c = Math.cos(planeYaw);
  const s = Math.sin(planeYaw);
  const wx = lx * c + lz * s;
  const wz = -lx * s + lz * c;

  out.set(wx, ly, wz);
  return out;
};

