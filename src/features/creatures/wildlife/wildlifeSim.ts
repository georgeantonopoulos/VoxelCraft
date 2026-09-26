/**
 * Wildlife behaviour: pure simulation (no rendering), unit-testable.
 *
 * Each species is a small state machine with steering:
 *  - Birds: flocks (boids) that wander above the canopy, land together to feed,
 *    hop on the ground, and burst into the air when the player approaches.
 *  - Deer: herds that graze (head down), amble to new spots, turn alert to watch
 *    an approaching player and bolt away together when it gets too close.
 *  - Fish: schools that cruise under the surface of rivers and the sea, dart away
 *    from the player and occasionally leap.
 *  - Rootling: a forest spirit that leads the player to the nearest dormant Root
 *    Hollow, waiting whenever the player falls behind.
 *
 * World queries go through `WildlifeWorld` so the sim can run against the real
 * terrain or a flat test world.
 */

export interface WildlifeWorld {
  /** Ground height (m) at a column. */
  groundAt(x: number, z: number): number;
  /** Water surface height, or null when the column is dry. */
  waterAt(x: number, z: number): number | null;
  /** 0..1: how suitable the biome at (x, z) is for a species. */
  habitat(kind: 'bird' | 'deer' | 'fish', x: number, z: number): number;
  /** Exact walkable surface under (x, yHint, z), e.g. a physics ray (dug terrain included). Optional. */
  surfaceAt?(x: number, z: number, yHint: number): number | null;
}

export interface Agent {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  /** Gait / flap phase (radians) and animation amplitude. */
  phase: number; amp: number;
  /** 0..1 head lowered (grazing). */
  head: number;
  group: number;
  seed: number;
  /** Per-agent timers. */
  t: number;
  groundY: number; groundX: number; groundZ: number;
}

export type FlockState = 'fly' | 'landing' | 'ground' | 'takeoff';
export type HerdState = 'graze' | 'walk' | 'alert' | 'flee';

export interface Group {
  kind: 'bird' | 'deer' | 'fish';
  state: FlockState | HerdState | 'swim';
  timer: number;
  /** Wander target / flock centre goal. */
  tx: number; ty: number; tz: number;
  members: Agent[];
}

export interface RootlingState {
  active: boolean;
  agent: Agent;
  mode: 'wait' | 'lead' | 'arrive' | 'burrow';
  targetX: number; targetZ: number;
  timer: number;
  /** Current travel speed (m/s), eased toward the pace the player sets. */
  pace?: number;
}

export interface PlayerInfo { x: number; y: number; z: number; /** Horizontal speed (m/s), if known. */ speed?: number; }

type Rand = () => number;

export const TUNING = {
  bird: { speed: 7, groundHop: 0.8, scatter: 10, altitude: [9, 20] as [number, number] },
  deer: { walk: 1.3, run: 9.5, alertDist: 24, fleeDist: 14, calmDist: 45 },
  fish: { speed: 1.6, dart: 5.5, fleeDist: 4.5 },
  rootling: { speed: 3.4, runSpeed: 9, leadGap: 7, waitDist: 18, startDist: 10, arriveDist: 5 },
};

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const approachAngle = (a: number, b: number, k: number) => a + wrapAngle(b - a) * k;

export function makeAgent(x: number, y: number, z: number, group: number, rand: Rand): Agent {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, yaw: rand() * Math.PI * 2, pitch: 0,
    phase: rand() * Math.PI * 2, amp: 0, head: 0, group, seed: rand(), t: rand() * 3,
    groundY: y, groundX: x, groundZ: z,
  };
}

/** Ground height with a per-agent cache (terrain queries are not free). */
function ground(a: Agent, world: WildlifeWorld): number {
  if ((a.x - a.groundX) ** 2 + (a.z - a.groundZ) ** 2 > 0.6) {
    a.groundY = world.groundAt(a.x, a.z);
    a.groundX = a.x; a.groundZ = a.z;
  }
  return a.groundY;
}

// ---------------------------------------------------------------------------
// Birds
// ---------------------------------------------------------------------------

export function updateBirds(g: Group, dt: number, player: PlayerInfo, world: WildlifeWorld, rand: Rand): void {
  const T = TUNING.bird;
  g.timer -= dt;
  const m = g.members;
  let cx = 0, cy = 0, cz = 0;
  for (const a of m) { cx += a.x; cy += a.y; cz += a.z; }
  cx /= m.length; cy /= m.length; cz /= m.length;
  const pd = Math.hypot(player.x - cx, player.z - cz);

  if (g.state === 'fly') {
    // Wander: new goal every few seconds, sometimes land to feed.
    if (g.timer <= 0) {
      const a = rand() * Math.PI * 2, r = 25 + rand() * 40;
      g.tx = cx + Math.cos(a) * r; g.tz = cz + Math.sin(a) * r;
      g.ty = world.groundAt(g.tx, g.tz) + T.altitude[0] + rand() * (T.altitude[1] - T.altitude[0]);
      g.timer = 6 + rand() * 8;
      if (rand() < 0.35 && pd > 30 && !world.waterAt(g.tx, g.tz)) { g.state = 'landing'; g.ty = world.groundAt(g.tx, g.tz); }
    }
  } else if (g.state === 'landing') {
    if (Math.hypot(cx - g.tx, cz - g.tz) < 6 && Math.abs(cy - g.ty) < 2.5) { g.state = 'ground'; g.timer = 12 + rand() * 20; }
  } else if (g.state === 'ground') {
    if (pd < T.scatter || g.timer <= 0) {
      g.state = 'takeoff'; g.timer = 1.2;
      g.ty = cy + 14; g.tx = cx + (cx - player.x) * 2; g.tz = cz + (cz - player.z) * 2;
    }
  } else if (g.state === 'takeoff' && g.timer <= 0) {
    g.state = 'fly'; g.timer = 0;
  }

  for (const a of m) {
    if (g.state === 'ground') {
      // Feeding: short hops between pecks, wings folded.
      a.t -= dt;
      const gy = ground(a, world);
      if (a.t <= 0) {
        const dir = rand() * Math.PI * 2;
        a.vx = Math.cos(dir) * T.groundHop; a.vz = Math.sin(dir) * T.groundHop; a.vy = 1.6;
        a.t = 0.6 + rand() * 2.2;
      }
      a.vy -= 9.8 * dt;
      a.x += a.vx * dt; a.z += a.vz * dt; a.y += a.vy * dt;
      if (a.y <= gy + 0.06) { a.y = gy + 0.06; a.vy = 0; a.vx *= 0.8; a.vz *= 0.8; }
      a.head = a.y <= gy + 0.07 ? 0.5 + 0.5 * Math.sin(a.phase * 0.3) : 0;
      a.amp = a.vy > 0.5 ? 0.9 : 0.05;
      a.phase += dt * (a.amp > 0.5 ? 26 : 2);
      if (Math.abs(a.vx) + Math.abs(a.vz) > 0.1) a.yaw = Math.atan2(a.vx, a.vz);
      a.pitch = 0;
      continue;
    }
    // Boids: separation, alignment, cohesion + goal seeking.
    let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0;
    for (const b of m) {
      if (b === a) continue;
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 2.2) { sx += dx / (d2 + 0.1); sy += dy / (d2 + 0.1); sz += dz / (d2 + 0.1); }
      ax += b.vx; ay += b.vy; az += b.vz;
    }
    const n = Math.max(1, m.length - 1);
    const speed = g.state === 'takeoff' ? T.speed * 1.5 : g.state === 'landing' ? T.speed * 0.6 : T.speed;
    let gx = g.tx - a.x, gy2 = g.ty - a.y, gz = g.tz - a.z;
    const gl = Math.hypot(gx, gy2, gz) + 1e-3;
    gx /= gl; gy2 /= gl; gz /= gl;
    const steerX = sx * 1.4 + (ax / n - a.vx) * 0.5 + (cx - a.x) * 0.25 + gx * speed * 0.9;
    const steerY = sy * 1.4 + (ay / n - a.vy) * 0.5 + (cy - a.y) * 0.25 + gy2 * speed * 0.9;
    const steerZ = sz * 1.4 + (az / n - a.vz) * 0.5 + (cz - a.z) * 0.25 + gz * speed * 0.9;
    a.vx += steerX * dt * 1.6; a.vy += steerY * dt * 1.6; a.vz += steerZ * dt * 1.6;
    const v = Math.hypot(a.vx, a.vy, a.vz);
    if (v > speed) { a.vx *= speed / v; a.vy *= speed / v; a.vz *= speed / v; }
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    // Stay above the terrain.
    const gyH = ground(a, world);
    const minY = gyH + (g.state === 'landing' ? 0.06 : 2.5);
    if (a.y < minY) { a.y = minY; a.vy = Math.max(a.vy, 0); }
    if (g.state === 'landing' && a.y < gyH + 0.5) { a.vx *= 0.9; a.vz *= 0.9; }
    a.yaw = approachAngle(a.yaw, Math.atan2(a.vx, a.vz), Math.min(1, dt * 6));
    a.pitch = Math.atan2(a.vy, Math.hypot(a.vx, a.vz)) * 0.6;
    // Flap harder when climbing, glide when descending.
    const climbing = a.vy > 0.3 || g.state === 'takeoff';
    const gliding = a.vy < -0.5 && g.state === 'fly';
    const targetAmp = climbing ? 1.0 : gliding ? 0.08 : 0.55 + 0.3 * Math.sin(a.seed * 20 + a.t);
    a.amp += (targetAmp - a.amp) * Math.min(1, dt * 4);
    a.phase += dt * (climbing ? 24 : 16);
    a.t += dt;
    a.head = 0;
  }
}

// ---------------------------------------------------------------------------
// Deer
// ---------------------------------------------------------------------------

export function updateDeer(g: Group, dt: number, player: PlayerInfo, world: WildlifeWorld, rand: Rand): void {
  const T = TUNING.deer;
  g.timer -= dt;
  const m = g.members;
  let cx = 0, cz = 0;
  for (const a of m) { cx += a.x; cz += a.z; }
  cx /= m.length; cz /= m.length;
  const pd = Math.hypot(player.x - cx, player.z - cz);

  // Herd decisions.
  if (g.state !== 'flee' && pd < T.fleeDist) {
    g.state = 'flee'; g.timer = 6 + rand() * 3;
    const ax = cx - player.x, az = cz - player.z, al = Math.hypot(ax, az) + 1e-3;
    g.tx = cx + (ax / al) * 60; g.tz = cz + (az / al) * 60;
  } else if (g.state === 'flee') {
    if (g.timer <= 0 && pd > T.calmDist) { g.state = 'alert'; g.timer = 3; }
  } else if (pd < T.alertDist && g.state !== 'alert') {
    g.state = 'alert'; g.timer = 4 + rand() * 4;
  } else if (g.state === 'alert' && g.timer <= 0) {
    g.state = pd < T.alertDist ? 'walk' : 'graze';
    g.timer = 5;
    if (g.state === 'walk') {
      // Calmly move away from the watcher.
      const ax = cx - player.x, az = cz - player.z, al = Math.hypot(ax, az) + 1e-3;
      g.tx = cx + (ax / al) * 25; g.tz = cz + (az / al) * 25;
    }
  } else if (g.state === 'graze' && g.timer <= 0) {
    g.state = 'walk'; g.timer = 8 + rand() * 8;
    const a = rand() * Math.PI * 2, r = 10 + rand() * 18;
    g.tx = cx + Math.cos(a) * r; g.tz = cz + Math.sin(a) * r;
    if (world.waterAt(g.tx, g.tz) !== null) { g.tx = cx; g.tz = cz; }
  } else if (g.state === 'walk' && (g.timer <= 0 || Math.hypot(g.tx - cx, g.tz - cz) < 3)) {
    g.state = 'graze'; g.timer = 10 + rand() * 18;
  }

  for (let i = 0; i < m.length; i++) {
    const a = m[i];
    a.t -= dt;
    let desired = 0;
    let dirX = 0, dirZ = 0;
    if (g.state === 'flee' || g.state === 'walk') {
      // Individual offset around the herd goal keeps them spread out.
      const ox = Math.cos(a.seed * 40) * 3, oz = Math.sin(a.seed * 40) * 3;
      dirX = g.tx + ox - a.x; dirZ = g.tz + oz - a.z;
      desired = g.state === 'flee' ? T.run * (0.9 + a.seed * 0.2) : T.walk;
      if (Math.hypot(dirX, dirZ) < 1) desired = 0;
    } else if (g.state === 'graze') {
      // Step a pace every few seconds while grazing.
      if (a.t <= 0) { a.t = 3 + rand() * 5; a.yaw += (rand() - 0.5) * 1.2; }
      if (a.t < 0.7) { desired = 0.5; dirX = Math.sin(a.yaw); dirZ = Math.cos(a.yaw); } // one pace, then graze
    } else if (g.state === 'alert') {
      // Face the player, head up, frozen.
      a.yaw = approachAngle(a.yaw, Math.atan2(player.x - a.x, player.z - a.z), Math.min(1, dt * 2));
    }
    // Separation from herd mates.
    for (const b of m) {
      if (b === a) continue;
      const dx = a.x - b.x, dz = a.z - b.z, d2 = dx * dx + dz * dz;
      if (d2 < 2.5 && d2 > 1e-4) { dirX += (dx / d2) * 1.5; dirZ += (dz / d2) * 1.5; }
    }
    const dl = Math.hypot(dirX, dirZ);
    const speed = Math.hypot(a.vx, a.vz);
    const accel = g.state === 'flee' ? 8 : 2.5;
    const target = desired;
    const ns = speed + Math.sign(target - speed) * Math.min(Math.abs(target - speed), accel * dt);
    if (dl > 1e-3 && ns > 0.05) {
      const heading = Math.atan2(dirX, dirZ);
      a.yaw = approachAngle(a.yaw, heading, Math.min(1, dt * (g.state === 'flee' ? 5 : 2)));
    }
    a.vx = Math.sin(a.yaw) * ns; a.vz = Math.cos(a.yaw) * ns;
    const nx = a.x + a.vx * dt, nz = a.z + a.vz * dt;
    // Don't walk into water or up cliffs.
    const ahead = world.waterAt(nx + a.vx * 0.4, nz + a.vz * 0.4);
    if (ahead === null) { a.x = nx; a.z = nz; } else { a.yaw += 1.5 * dt * 3; a.vx = 0; a.vz = 0; }
    const gy = ground(a, world);
    a.y += (gy - a.y) * Math.min(1, dt * 10);
    // Gait: phase advances with distance; amplitude from speed.
    a.phase += ns * dt * (ns > 4 ? 2.4 : 5.5);
    a.amp += (Math.min(1, ns / 2.5) - a.amp) * Math.min(1, dt * 5);
    const wantHead = g.state === 'graze' && ns < 0.2 ? 1 : 0;
    a.head += (wantHead - a.head) * Math.min(1, dt * (wantHead ? 1.2 : 5));
    a.pitch = 0;
  }
}

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

export function updateFish(g: Group, dt: number, player: PlayerInfo, world: WildlifeWorld, rand: Rand): void {
  const T = TUNING.fish;
  g.timer -= dt;
  const m = g.members;
  let cx = 0, cz = 0;
  for (const a of m) { cx += a.x; cz += a.z; }
  cx /= m.length; cz /= m.length;
  if (g.timer <= 0) {
    // New cruise target inside water.
    for (let k = 0; k < 6; k++) {
      const ang = rand() * Math.PI * 2, r = 4 + rand() * 12;
      const tx = cx + Math.cos(ang) * r, tz = cz + Math.sin(ang) * r;
      if (world.waterAt(tx, tz) !== null && world.groundAt(tx, tz) < (world.waterAt(tx, tz) ?? 0) - 1) { g.tx = tx; g.tz = tz; break; }
    }
    g.timer = 4 + rand() * 6;
  }
  for (const a of m) {
    const surface = world.waterAt(a.x, a.z);
    const bed = ground(a, world);
    const pdx = a.x - player.x, pdz = a.z - player.z;
    const pd = Math.hypot(pdx, pdz);
    let dx = g.tx - a.x + Math.cos(a.seed * 50) * 1.5, dz = g.tz - a.z + Math.sin(a.seed * 50) * 1.5;
    let speed = T.speed;
    if (pd < T.fleeDist && Math.abs(player.y - a.y) < 4) { dx = pdx; dz = pdz; speed = T.dart; }
    for (const b of m) {
      if (b === a) continue;
      const sx = a.x - b.x, sz = a.z - b.z, d2 = sx * sx + sz * sz;
      if (d2 < 0.5 && d2 > 1e-5) { dx += (sx / d2) * 0.6; dz += (sz / d2) * 0.6; }
    }
    a.yaw = approachAngle(a.yaw, Math.atan2(dx, dz), Math.min(1, dt * (speed > T.speed ? 8 : 2.5)));
    const cur = Math.hypot(a.vx, a.vz);
    const ns = cur + (speed - cur) * Math.min(1, dt * 3);
    a.vx = Math.sin(a.yaw) * ns; a.vz = Math.cos(a.yaw) * ns;
    const nx = a.x + a.vx * dt, nz = a.z + a.vz * dt;
    if (world.waterAt(nx, nz) !== null && world.groundAt(nx, nz) < (world.waterAt(nx, nz) ?? 0) - 0.5) { a.x = nx; a.z = nz; }
    else a.yaw += Math.PI * 0.5; // turn back from the shore
    // Depth: cruise between bed and surface; occasional leap.
    a.t -= dt;
    if (surface !== null) {
      const cruise = Math.max(bed + 0.3, surface - 0.5 - a.seed * 0.8);
      if (a.t <= 0 && rand() < 0.02) { a.vy = 4.2; a.t = 8 + rand() * 20; }
      if (a.vy !== 0) {
        a.vy -= 9.8 * dt; a.y += a.vy * dt;
        if (a.y < cruise && a.vy < 0) { a.vy = 0; }
        a.pitch = Math.atan2(a.vy, Math.max(0.5, ns)) * 0.8;
      } else {
        a.y += (cruise - a.y) * Math.min(1, dt * 1.5);
        a.pitch = 0;
      }
    }
    a.phase += dt * (6 + ns * 6);
    a.amp = 0.6 + Math.min(0.8, ns / T.dart);
  }
}

// ---------------------------------------------------------------------------
// Rootling guide
// ---------------------------------------------------------------------------

const smooth01 = (x: number, lo: number, hi: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Ground under the rootling, sampled every frame: the exact surface if the world offers it, else bilinear heights. */
function rootlingGround(a: Agent, world: WildlifeWorld): number {
  const exact = world.surfaceAt?.(a.x, a.z, a.y);
  if (exact != null) return exact;
  const x0 = Math.floor(a.x), z0 = Math.floor(a.z), fx = a.x - x0, fz = a.z - z0;
  const h00 = world.groundAt(x0, z0), h10 = world.groundAt(x0 + 1, z0);
  const h01 = world.groundAt(x0, z0 + 1), h11 = world.groundAt(x0 + 1, z0 + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** Returns true on the frame the rootling reaches the hollow with the player. */
export function updateRootling(r: RootlingState, dt: number, player: PlayerInfo, world: WildlifeWorld): boolean {
  if (!r.active) return false;
  const T = TUNING.rootling;
  const a = r.agent;
  r.timer -= dt;
  const pd = Math.hypot(player.x - a.x, player.z - a.z);
  const td = Math.hypot(r.targetX - a.x, r.targetZ - a.z);
  let arrived = false;
  let want = 0;

  if (r.mode === 'wait') {
    a.yaw = approachAngle(a.yaw, Math.atan2(player.x - a.x, player.z - a.z), Math.min(1, dt * 3));
    if (pd < T.startDist) r.mode = 'lead';
  } else if (r.mode === 'lead') {
    if (pd > T.waitDist) {
      r.mode = 'wait';
    } else if (td < T.arriveDist) {
      r.mode = 'arrive'; r.timer = 2.5;
    } else {
      // Stay a few strides ahead: stroll while the player hangs back, run as
      // they close in, and sprint past if they overtake (always faster than them).
      const pt = Math.hypot(r.targetX - player.x, r.targetZ - player.z);
      const urge = Math.max(1 - smooth01(pd, T.leadGap * 0.4, T.leadGap), pt < td ? 1 : 0);
      const top = Math.max(T.runSpeed, (player.speed ?? 0) * 1.3);
      want = T.speed + (top - T.speed) * urge;
      let dx = r.targetX - a.x, dz = r.targetZ - a.z;
      // Walk around water rather than into it.
      const probeX = a.x + Math.sin(a.yaw) * 1.5, probeZ = a.z + Math.cos(a.yaw) * 1.5;
      if (world.waterAt(probeX, probeZ) !== null) { dx = Math.cos(a.yaw) * 3; dz = -Math.sin(a.yaw) * 3; }
      a.yaw = approachAngle(a.yaw, Math.atan2(dx, dz), Math.min(1, dt * 3));
    }
  } else if (r.mode === 'arrive') {
    // A little dance, then burrow into the ground at the hollow.
    a.yaw += dt * 5;
    if (r.timer <= 0) { r.mode = 'burrow'; r.timer = 1.8; arrived = pd < 18; }
  } else if (r.mode === 'burrow') {
    a.y -= dt * 0.5;
    if (r.timer <= 0) r.active = false;
  }

  r.pace = (r.pace ?? 0) + (want - (r.pace ?? 0)) * Math.min(1, dt * 4);
  const speed = r.pace < 0.05 ? 0 : r.pace;
  a.vx = Math.sin(a.yaw) * speed; a.vz = Math.cos(a.yaw) * speed;
  a.x += a.vx * dt; a.z += a.vz * dt;
  if (r.mode !== 'burrow') {
    // Follow the ground closely and never sink into it (running uphill outpaced a soft follow).
    const gy = rootlingGround(a, world);
    a.y += (gy - a.y) * Math.min(1, dt * 20);
    if (a.y < gy - 0.03) a.y = gy - 0.03;
  }
  // Running: bounding gait (the shader reads this from the head channel).
  const run = smooth01(speed, 4.5, 7);
  a.head = run;
  const walkRate = speed * 3.3;
  a.phase += dt * (speed > 0 ? walkRate + (13 + speed * 0.4 - walkRate) * run : r.mode === 'arrive' ? 14 : 2);
  a.amp += ((speed > 0 || r.mode === 'arrive' ? 1 : 0.15) - a.amp) * Math.min(1, dt * 6);
  return arrived;
}
