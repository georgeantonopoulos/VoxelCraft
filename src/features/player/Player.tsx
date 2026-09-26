import * as THREE from 'three';
import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '@/constants';
import { MaterialType } from '@/types';
import { useLogStore } from '@/state/LogStore';
import { useGroveStore } from '@state/GroveStore';
import { strideMultiplier } from '@features/grove/questLine';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { usePlayerInput } from './usePlayerInput';
import { useWorldStore } from '@/state/WorldStore';
import { useEnvironmentStore } from '@/state/EnvironmentStore';
import { LuminaExitFinder } from '@features/terrain/logic/LuminaExitFinder';
import { frameProfiler } from '@core/utils/FrameProfiler';
import { updatePlayerState, notifyListeners } from '@core/player/PlayerState';

const FLY_SPEED = 24; // Increased for faster testing
const DOUBLE_TAP_TIME = 300;
const SWIM_SPEED = 4.0;
const SWIM_VERTICAL_SPEED = 4.5;

// Scratch objects to avoid per-frame allocations
const scratchPos = new THREE.Vector3();
const scratchMoveDir = new THREE.Vector3();
const scratchCamDir = new THREE.Vector3();
const scratchForward = new THREE.Vector3();
const scratchSide = new THREE.Vector3();
const scratchUp = new THREE.Vector3(0, 1, 0);
/** Surface family for footstep sounds (null = nothing solid underfoot). */
const footstepSurface = (m: MaterialType | null): 'grass' | 'dirt' | 'sand' | 'stone' | 'snow' | null => {
  switch (m) {
    case MaterialType.GRASS: case MaterialType.JUNGLE_GRASS: return 'grass';
    case MaterialType.DIRT: case MaterialType.CLAY: return 'dirt';
    case MaterialType.SAND: case MaterialType.RED_SAND: return 'sand';
    case MaterialType.SNOW: case MaterialType.ICE: return 'snow';
    case MaterialType.STONE: case MaterialType.BEDROCK: case MaterialType.MOSSY_STONE:
    case MaterialType.TERRACOTTA: case MaterialType.OBSIDIAN: case MaterialType.GLOW_STONE: return 'stone';
    default: return null;
  }
};

const scratchVelocity = new THREE.Vector3();
const scratchCameraPos = new THREE.Vector3();
const scratchPushDir = new THREE.Vector3();

/** Camera wall probes only consider terrain (not items, flora, etc.). */
const isTerrainCollider = (collider: { parent: () => { userData?: unknown } | null }): boolean =>
  (collider.parent()?.userData as { type?: string } | undefined)?.type === 'terrain';

// Camera collision constants
const EYE_HEIGHT = 0.75;
const EYE_HEIGHT_CROUCHED = 0.25;
const CAMERA_CLIP_MARGIN = 0.15; // Larger than the near plane's corner distance (~0.09 m at near 0.05) so walls never clip

// Crouch constants
const CROUCH_SPEED_MULTIPLIER = 0.5;
const CAPSULE_HALF_HEIGHT_NORMAL = 0.4;
const CAPSULE_HALF_HEIGHT_CROUCHED = 0.1;
const CAPSULE_RADIUS = 0.4;
/** Distance below the capsule's feet that still counts as standing (slopes, steps). */
const GROUND_TOLERANCE = 0.35;
/** Ground steeper than this (normal.y = cos 50 degrees) is not stood on: the player slides. */
const WALKABLE_NORMAL_Y = 0.64;
/** How far below the spawn point to look for a terrain collider before releasing the player. */
const SPAWN_GROUND_SEARCH = 64;
/** Downward reach of the unloaded-ground guard (deeper than any column: surface to bedrock). */
const UNLOADED_GROUND_SEARCH = 256;
const CAMERA_PUSH_DIRECTIONS = [
  { x: 1, y: 0, z: 0 },   // Right
  { x: -1, y: 0, z: 0 },  // Left
  { x: 0, y: 0, z: 1 },   // Forward
  { x: 0, y: 0, z: -1 },  // Back
  { x: 0, y: 1, z: 0 },   // Up
  { x: 0, y: -1, z: 0 },  // Down
  // Diagonals for corners
  { x: 0.707, y: 0, z: 0.707 },
  { x: 0.707, y: 0, z: -0.707 },
  { x: -0.707, y: 0, z: 0.707 },
  { x: -0.707, y: 0, z: -0.707 },
];
export const Player = ({ position = [16, 32, 16] }: { position?: [number, number, number] }) => {
  const body = useRef<any>(null);
  const collider = useRef<any>(null);
  const [isLuminaDashing, setIsLuminaDashing] = useState(false);
  const luminaTarget = useRef<THREE.Vector3 | null>(null);

  const getInput = usePlayerInput();
  const { rapier, world } = useRapier();
  // Reused every frame for the camera wall probes (no per-frame allocations).
  const cameraRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }), [rapier]);
  const groundProbeRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), [rapier]);
  const [isFlying, setIsFlying] = useState(false);
  const isCrouching = useRef(false);
  const lastSpacePress = useRef<number>(0);
  const wasJumpPressed = useRef<boolean>(false);
  const strideDistance = useRef(0);
  const spacePressHandled = useRef<boolean>(false);

  const setPlayerParams = useWorldStore((state) => state.setPlayerParams);

  // Debug/automation hooks (browser checks without pointer lock):
  // window.__vcDebug.teleport(x, y, z) and window.__vcDebug.look(yawRad, pitchRad)
  const camera = useThree((st) => st.camera);

  // First view on waking: level with the land, a touch below the horizon.
  // (The camera kept the title flyover's steep downward look, or with
  // ?autostart whatever it had, so the first frame was often sky or ground.)
  useEffect(() => {
    camera.rotation.set(-0.08, camera.rotation.y, 0, 'YXZ');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const api = {
      teleport: (x: number, y: number, z: number) => {
        body.current?.setTranslation({ x, y, z }, true);
        body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
      },
      look: (yaw: number, pitch: number) => {
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
      },
      /** Player body position, velocity and gravity scale, plus the current input. */
      player: () => {
        const b = body.current;
        if (!b) return null;
        return { t: b.translation(), v: b.linvel(), gravity: b.gravityScale(), input: getInput() };
      },
      /** Terrain rigid bodies in the physics world: chunk key, translation, collider shape types. */
      terrainBodies: () => {
        const out: { key: string; t: [number, number, number]; shapes: number[] }[] = [];
        world.forEachRigidBody((b) => {
          const ud = b.userData as { type?: string; key?: string } | undefined;
          if (ud?.type !== 'terrain') return;
          const t = b.translation();
          const shapes: number[] = [];
          for (let i = 0; i < b.numColliders(); i++) shapes.push(b.collider(i).shapeType());
          out.push({ key: ud.key ?? '?', t: [t.x, t.y, t.z], shapes });
        });
        return out;
      },
      /** Colliders whose bounding boxes overlap a cube of half-size r at (x, y, z): owner userData, shape type, body translation. */
      collidersNear: (x: number, y: number, z: number, r = 2) => {
        const out: { owner: unknown; shape: number; at: number[] }[] = [];
        world.collidersWithAabbIntersectingAabb({ x, y, z }, { x: r, y: r, z: r }, (c) => {
          const t = c.translation();
          out.push({ owner: c.parent()?.userData, shape: c.shapeType(), at: [t.x, t.y, t.z] });
          return true;
        });
        return out;
      },
      /** First terrain hit straight down from (x, y, z), or null. */
      rayDown: (x: number, y: number, z: number, max = 256) => {
        const ray = new rapier.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, max, true, undefined, undefined, undefined, undefined, isTerrainCollider);
        return hit ? y - hit.timeOfImpact : null;
      },
    };
    (window as unknown as { __vcDebug?: typeof api }).__vcDebug = api;
    return () => { delete (window as unknown as { __vcDebug?: typeof api }).__vcDebug; };
  }, [camera, world, rapier]);

  // Throttle WorldStore sync for backward compatibility (10Hz instead of 60fps)
  const lastStoreSyncTime = useRef(0);
  const lastStoreSyncPos = useRef({ x: 0, z: 0 });
  const STORE_SYNC_INTERVAL = 100; // ms
  const STORE_SYNC_DISTANCE_SQ = 0.25; // 0.5m squared

  // Spawn guard: the player's chunk collider can arrive a few frames after the
  // player mounts. During a load hitch Rapier catch-up steps dropped the body
  // straight through the (not yet present) surface into caves below. Hold the
  // body weightless at its spawn point until a downward ray finds ground.
  const [spawnSettled, setSpawnSettled] = useState(false);

  useEffect(() => {
    if (!body.current) return;
    body.current.setGravityScale(isFlying || !spawnSettled ? 0 : 1, true);
  }, [isFlying, spawnSettled]);

  useEffect(() => {
    const handleLumina = () => {
      if (!body.current) return;
      const pos = body.current.translation();
      const exit = LuminaExitFinder.findClosestExit(pos.x, pos.y, pos.z);

      if (exit) {
        luminaTarget.current = new THREE.Vector3(exit.x, exit.y, exit.z);
        setIsLuminaDashing(true);
        window.dispatchEvent(new CustomEvent('lumina-glow-start', { detail: { duration: 1000 } }));
      }
    };
    window.addEventListener('lumina-special-action', handleLumina);
    return () => window.removeEventListener('lumina-special-action', handleLumina);
  }, []);

  useFrame((state, delta) => {
    frameProfiler.begin('player');
    if (!body.current) {
      frameProfiler.end('player');
      return;
    }

    if (!spawnSettled) {
      const ray = new rapier.Ray({ x: position[0], y: position[1], z: position[2] }, { x: 0, y: -1, z: 0 });
      const ground = world.castRay(ray, SPAWN_GROUND_SEARCH, true, undefined, undefined, undefined, body.current);
      body.current.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
      body.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (ground) setSpawnSettled(true);
    }

    const pos = body.current.translation();
    scratchPos.set(pos.x, pos.y, pos.z);

    if (isLuminaDashing && luminaTarget.current) {
      const dist = scratchPos.distanceTo(luminaTarget.current);
      if (dist < 0.5) {
        setIsLuminaDashing(false);
        luminaTarget.current = null;
      } else {
        scratchMoveDir.copy(luminaTarget.current).sub(scratchPos);
        if (scratchMoveDir.lengthSq() > 0.001) {
          scratchMoveDir.normalize();
          scratchMoveDir.multiplyScalar(Math.min(dist, delta * 120));
          body.current.setTranslation({
            x: pos.x + scratchMoveDir.x,
            y: pos.y + scratchMoveDir.y,
            z: pos.z + scratchMoveDir.z
          }, true);
        } else {
          setIsLuminaDashing(false);
          luminaTarget.current = null;
        }
        frameProfiler.end('player');
        return;
      }
    }

    const { move, jump, shift, crouch } = getInput();
    const vel = body.current.linvel();
    scratchVelocity.set(vel.x, vel.y, vel.z);

    const camera = state.camera;

    // Water/Swimming logic
    const footY = pos.y - 0.65;
    const midY = pos.y;
    const headY = pos.y + 0.65;
    const footInWater = terrainRuntime.isLiquidAtWorld(pos.x, footY, pos.z);
    const midInWater = terrainRuntime.isLiquidAtWorld(pos.x, midY, pos.z);
    const headInWater = terrainRuntime.isLiquidAtWorld(pos.x, headY, pos.z);
    const waterHits = (footInWater ? 1 : 0) + (midInWater ? 1 : 0) + (headInWater ? 1 : 0);
    const inWater = waterHits > 0;
    const submersion = waterHits / 3.0;

    // Underwater visuals (grade, fringing, bubbles, vignette) follow the CAMERA,
    // not the body: standing in the shallows or swimming at the surface used to
    // blend in 1/3-2/3 underwater look. Voxel lookups also round a whole cell to
    // water, so compare the eye against the real surface height instead.
    const eyeY = pos.y + (isCrouching.current ? EYE_HEIGHT_CROUCHED : EYE_HEIGHT);
    const seaSurfaceY = terrainRuntime.getSeaSurfaceYAtWorld(pos.x, pos.z);
    const eyeDepth = seaSurfaceY != null
      ? seaSurfaceY - eyeY
      : (terrainRuntime.isLiquidAtWorld(pos.x, eyeY, pos.z) ? 1 : -1);
    const underwaterVisual = THREE.MathUtils.smoothstep(eyeDepth, 0.0, 0.2);
    const setUnderwaterBlend = useEnvironmentStore.getState().setUnderwaterBlend;
    const setUnderwaterState = useEnvironmentStore.getState().setUnderwaterState;
    setUnderwaterBlend(underwaterVisual);
    const isFullyUnderwater = eyeDepth > 0;
    const currentUnderwaterState = useEnvironmentStore.getState().isUnderwater;
    if (isFullyUnderwater !== currentUnderwaterState) {
      setUnderwaterState(isFullyUnderwater, state.clock.getElapsedTime());
    }

    // Crouching resizes the capsule around its centre, so shift the body by the
    // height change to keep the feet planted (shrinking used to drop the player
    // 0.3m every crouch and growing pushed the capsule into the ground).
    const setCrouched = (next: boolean) => {
      if (!collider.current || !body.current) return;
      const delta = CAPSULE_HALF_HEIGHT_NORMAL - CAPSULE_HALF_HEIGHT_CROUCHED;
      const t = body.current.translation();
      if (!next) {
        // Stand up only with headroom above the crouched capsule.
        const top = t.y + CAPSULE_HALF_HEIGHT_CROUCHED + CAPSULE_RADIUS;
        const ray = new rapier.Ray({ x: t.x, y: top, z: t.z }, { x: 0, y: 1, z: 0 });
        if (world.castRay(ray, delta * 2 + 0.05, true, undefined, undefined, undefined, body.current)) return;
      }
      isCrouching.current = next;
      collider.current.setHalfHeight(next ? CAPSULE_HALF_HEIGHT_CROUCHED : CAPSULE_HALF_HEIGHT_NORMAL);
      body.current.setTranslation({ x: t.x, y: t.y + (next ? -delta : delta), z: t.z }, true);
    };
    if (crouch !== isCrouching.current && !isFlying && !inWater) setCrouched(crouch);
    // Reset crouch when flying or in water
    if ((isFlying || inWater) && isCrouching.current) setCrouched(false);

    // Calculate rotation for minimap
    camera.getWorldDirection(scratchCamDir);
    const rotation = Math.atan2(-scratchCamDir.x, -scratchCamDir.z);

    // Update singleton every frame (no allocations, no subscriptions triggered)
    updatePlayerState(pos.x, pos.y, pos.z, rotation);
    notifyListeners(); // Throttled internally to 10Hz

    // Sync to WorldStore at reduced frequency for backward compatibility
    const now = performance.now();
    const dx = pos.x - lastStoreSyncPos.current.x;
    const dz = pos.z - lastStoreSyncPos.current.z;
    const distSq = dx * dx + dz * dz;
    if (now - lastStoreSyncTime.current > STORE_SYNC_INTERVAL || distSq > STORE_SYNC_DISTANCE_SQ) {
      setPlayerParams({ x: pos.x, y: pos.y, z: pos.z, rotation });
      lastStoreSyncTime.current = now;
      lastStoreSyncPos.current = { x: pos.x, z: pos.z };
    }

    // Movement calculation: Use horizontal heading to avoid speed loss when looking down
    scratchForward.copy(scratchCamDir);
    scratchForward.y = 0;
    scratchForward.normalize();

    // Cross product with Up gives Side vector (Right)
    scratchSide.crossVectors(scratchUp, scratchForward).normalize();

    // move.z is forward/back (-1 is W), move.x is left/right
    scratchMoveDir.set(0, 0, 0);
    scratchMoveDir.addScaledVector(scratchForward, -move.z);
    scratchMoveDir.addScaledVector(scratchSide, -move.x);

    const crouchMul = isCrouching.current ? CROUCH_SPEED_MULTIPLIER : 1.0;
    // Keeper rank perk: faster stride on foot (see questLine.strideMultiplier).
    const strideMul = strideMultiplier(useGroveStore.getState().progression.essence);
    // Carrying a log slows the walk.
    const carryMul = useLogStore.getState().carriedId ? 0.65 : 1.0;
    const baseSpeed = isFlying ? FLY_SPEED : (inWater ? SWIM_SPEED : PLAYER_SPEED * crouchMul * strideMul * carryMul);
    const drag = (inWater && !isFlying) ? (1.0 - 0.35 * submersion) : 1.0;

    if (scratchMoveDir.lengthSq() > 1.0) scratchMoveDir.normalize();
    scratchMoveDir.multiplyScalar(baseSpeed * drag);

    let yVelocity = scratchVelocity.y;

    // Jump / Fly double tap
    const isDoubleTap = jump && !wasJumpPressed.current && !inWater;
    if (isDoubleTap) {
      const now = Date.now();
      if (now - lastSpacePress.current < DOUBLE_TAP_TIME) {
        setIsFlying(prev => !prev);
        lastSpacePress.current = 0;
        spacePressHandled.current = true;
      } else {
        lastSpacePress.current = now;
      }
    }

    if (isFlying) {
      if (jump && !spacePressHandled.current) yVelocity = FLY_SPEED;
      else if (shift) yVelocity = -FLY_SPEED;
      else yVelocity = 0;
    } else if (inWater) {
      if (jump && !spacePressHandled.current) {
        yVelocity = SWIM_VERTICAL_SPEED;
      } else if (shift) {
        yVelocity = -SWIM_VERTICAL_SPEED;
      } else {
        const surfaceY = terrainRuntime.getSeaSurfaceYAtWorld(pos.x, pos.z);
        if (surfaceY != null) {
          const targetCenterY = surfaceY - 0.55;
          const error = targetCenterY - pos.y;
          yVelocity = THREE.MathUtils.clamp(error * 2.2 - scratchVelocity.y * 0.35, -3.0, 3.0);
        } else {
          yVelocity = scratchVelocity.y * 0.7;
        }
      }
    } else {
      if (jump && !wasJumpPressed.current && !spacePressHandled.current) {
        // Grounded check: exclude the player's own body (a solid ray starting inside
        // the capsule otherwise hits it at t=0, allowing infinite mid-air jumps).
        const halfHeight = isCrouching.current ? CAPSULE_HALF_HEIGHT_CROUCHED : CAPSULE_HALF_HEIGHT_NORMAL;
        const feetDistance = halfHeight + CAPSULE_RADIUS;
        const t = body.current.translation();
        const ray = new rapier.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, feetDistance + GROUND_TOLERANCE, true, undefined, undefined, undefined, body.current);
        if (hit && hit.timeOfImpact <= feetDistance + GROUND_TOLERANCE) yVelocity = JUMP_FORCE;
      }
    }

    // Unloaded-ground guard: every loaded column has terrain (at worst bedrock)
    // below it. If a downward ray finds no terrain collider at all, the chunk
    // under the player has not got its collider yet (fast travel into a chunk
    // still generating), so hold height instead of falling through the world.
    if (!isFlying && !inWater && yVelocity < 0) {
      groundProbeRay.origin.x = pos.x;
      groundProbeRay.origin.y = pos.y;
      groundProbeRay.origin.z = pos.z;
      const below = world.castRay(groundProbeRay, UNLOADED_GROUND_SEARCH, true, undefined, undefined, undefined, undefined, isTerrainCollider);
      if (!below) yVelocity = 0;
    }

    // Standing still on a slope: the body is frictionless, so gravity pressing
    // it into the ground made the solver slide it downhill every step. While
    // idle on walkable ground, switch gravity off and hold still; steep faces
    // (normal below ~50 degrees from up) still slide.
    let holdOnSlope = false;
    if (!isFlying && !inWater && spawnSettled && scratchMoveDir.lengthSq() < 1e-4
      && yVelocity <= 0.5 && !(jump && !spacePressHandled.current)) {
      const halfHeight = isCrouching.current ? CAPSULE_HALF_HEIGHT_CROUCHED : CAPSULE_HALF_HEIGHT_NORMAL;
      groundProbeRay.origin.x = pos.x;
      groundProbeRay.origin.y = pos.y;
      groundProbeRay.origin.z = pos.z;
      // On a slope the capsule rests on its side, so the ground under its
      // centre sits halfHeight + radius / normal.y below it. Only hold when
      // actually resting there (never hover above a step).
      const hit = world.castRayAndGetNormal(groundProbeRay, halfHeight + CAPSULE_RADIUS / WALKABLE_NORMAL_Y + 0.06, true, undefined, undefined, undefined, body.current);
      holdOnSlope = !!hit && hit.normal.y > WALKABLE_NORMAL_Y
        && hit.timeOfImpact <= halfHeight + CAPSULE_RADIUS / hit.normal.y + 0.06;
    }
    if (holdOnSlope) yVelocity = 0;
    if (!isFlying && spawnSettled) body.current.setGravityScale(holdOnSlope ? 0 : 1, false);

    if (!jump && wasJumpPressed.current) spacePressHandled.current = false;
    wasJumpPressed.current = jump;

    body.current.setLinvel({ x: scratchMoveDir.x, y: yVelocity, z: scratchMoveDir.z }, true);

    // Footsteps: one per stride while walking on the ground or wading.
    const horizSpeed = Math.hypot(scratchVelocity.x, scratchVelocity.z);
    if (!isFlying && horizSpeed > 0.6) {
      strideDistance.current += horizSpeed * delta;
      const stride = isCrouching.current ? 1.1 : 1.9;
      if (strideDistance.current >= stride) {
        strideDistance.current = 0;
        const halfHeight = isCrouching.current ? CAPSULE_HALF_HEIGHT_CROUCHED : CAPSULE_HALF_HEIGHT_NORMAL;
        const feetY = pos.y - halfHeight - CAPSULE_RADIUS;
        const grounded = Math.abs(scratchVelocity.y) < 2.5;
        const surface = inWater ? 'water' : grounded
          ? (footstepSurface(terrainRuntime.getMaterialAtWorld(pos.x, feetY - 0.35, pos.z))
            ?? footstepSurface(terrainRuntime.getMaterialAtWorld(pos.x, feetY - 1.0, pos.z)))
          : null;
        if (surface) {
          const loudness = (isCrouching.current ? 0.35 : 0.75) * Math.min(1, horizSpeed / PLAYER_SPEED);
          window.dispatchEvent(new CustomEvent('vc-audio-footstep', { detail: { surface, loudness } }));
        }
      }
    } else {
      strideDistance.current = Math.min(strideDistance.current, 1.0);
    }

    // Sync camera to body eye level with wall collision detection
    // Start with intended eye position (lower when crouching)
    const eyeHeight = isCrouching.current ? EYE_HEIGHT_CROUCHED : EYE_HEIGHT;
    scratchCameraPos.set(pos.x, pos.y + eyeHeight, pos.z);

    // Raycast in multiple directions from camera position to detect nearby terrain walls
    // Push camera away from any walls that are too close
    // Filter to only hit terrain colliders (not items, flora, etc.)
    for (const dir of CAMERA_PUSH_DIRECTIONS) {
      cameraRay.origin.x = scratchCameraPos.x;
      cameraRay.origin.y = scratchCameraPos.y;
      cameraRay.origin.z = scratchCameraPos.z;
      cameraRay.dir = dir;
      const hit = world.castRay(cameraRay, CAMERA_CLIP_MARGIN, true, undefined, undefined, undefined, undefined, isTerrainCollider);
      if (hit && hit.timeOfImpact < CAMERA_CLIP_MARGIN) {
        // Wall is too close - push camera away from it
        const pushDistance = CAMERA_CLIP_MARGIN - hit.timeOfImpact;
        scratchPushDir.set(-dir.x, -dir.y, -dir.z).multiplyScalar(pushDistance);
        scratchCameraPos.add(scratchPushDir);
      }
    }

    camera.position.copy(scratchCameraPos);
    frameProfiler.end('player');
  });

  return (
    <RigidBody
      ref={body}
      colliders={false}
      mass={1}
      type="dynamic"
      position={position}
      gravityScale={0}
      enabledRotations={[false, false, false]}
      friction={0}
      // Terrain trimeshes have no thickness: without CCD a fast fall can step past one.
      ccd
    >
      <CapsuleCollider ref={collider} args={[CAPSULE_HALF_HEIGHT_NORMAL, CAPSULE_RADIUS]} />
    </RigidBody>
  );
};

