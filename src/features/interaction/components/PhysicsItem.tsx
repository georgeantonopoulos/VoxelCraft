import React, { useRef, useEffect, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { physicsItemBodies } from '@/state/physicsItemBodies';
import { RigidBody, RapierRigidBody, CapsuleCollider, CuboidCollider, useRapier } from '@react-three/rapier';
import { PositionalAudio } from '@react-three/drei';
import * as THREE from 'three';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { useInventoryStore } from '@state/InventoryStore';
import { MESH_Y_OFFSET } from '@/constants';
import { ItemType, ActivePhysicsItem, MaterialType } from '@/types';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { getItemMetadata } from '../logic/ItemRegistry';
import { UniversalTool } from './UniversalTool';
import { emitImpact } from './ImpactFX';
import { addWaterRipple } from '@core/graphics/waterRipples';
import { Campfire } from './Campfire';
import { emitSpark } from './SparkSystem';
import { useEntityHistoryStore } from '@/state/EntityHistoryStore';

// Fire sound URL for spatial audio
import fireUrl from '@/assets/sounds/fire.mp3?url';

interface PhysicsItemProps {
  item: ActivePhysicsItem;
}

const IMPACT_THRESHOLD_STICK = 5.0; // Lowered to make planting more reliable

const isHardImpactSurface = (mat: MaterialType | null): boolean => {
  return mat === MaterialType.STONE || mat === MaterialType.BEDROCK || mat === MaterialType.MOSSY_STONE;
};

// Helper to play sounds via AudioManager
const playSound = (soundId: string, options?: { pitch?: number; volume?: number }) => {
  window.dispatchEvent(new CustomEvent('vc-audio-play', {
    detail: { soundId, options }
  }));
};

const ITEM_LIFECYCLE_INTERVAL_S = 1.0;
/** Beyond this, the item's chunk collider may be gone: freeze the body. */
const ITEM_FREEZE_DISTANCE = 72;
/** Hysteresis: resume simulation once back within this range. */
const ITEM_THAW_DISTANCE = 56;
const scratchItemPos = new THREE.Vector3();

/** Items already shattered this session (guards duplicate collision events). */
const shatteredItemIds = new Set<string>();

export const PhysicsItem: React.FC<PhysicsItemProps> = ({ item }) => {
  const rigidBody = useRef<RapierRigidBody>(null);
  const removeItem = usePhysicsItemStore((state) => state.removeItem);
  const spawnItem = usePhysicsItemStore((state) => state.spawnItem);
  const updateItem = usePhysicsItemStore((state) => state.updateItem);
  const { world, rapier } = useRapier();

  // Audio hooks replaced with shared pool references


  const lastVel = useRef(new THREE.Vector3());
  // Above the water last frame (null: unknown), to catch the moment it goes in.
  const wasAboveWater = useRef<boolean | null>(null);

  // Register a getter so the world save can record where the item came to
  // rest: it reads the currently mounted body (planting remounts it).
  useEffect(() => {
    const get = () => rigidBody.current;
    physicsItemBodies.set(item.id, get);
    return () => { if (physicsItemBodies.get(item.id) === get) physicsItemBodies.delete(item.id); };
  }, [item.id]);

  // Lifecycle guard (throttled): items used to live forever. Far from the player
  // their chunk collider may unload, so freeze them in place; anything that
  // still falls below the world is removed (tools/pickaxes go back to inventory).
  const lifecycleTimer = useRef(0);
  useFrame((state, delta) => {
    lifecycleTimer.current += delta;
    if (lifecycleTimer.current < ITEM_LIFECYCLE_INTERVAL_S) return;
    lifecycleTimer.current = 0;
    const rb = rigidBody.current;
    if (!rb) return;
    const t = rb.translation();
    if (t.y < MESH_Y_OFFSET - 20) {
      if (item.customToolData) useInventoryStore.getState().addCustomTool(item.customToolData);
      else if (item.type === ItemType.PICKAXE) useInventoryStore.getState().setHasPickaxe(true);
      removeItem(item.id);
      return;
    }
    const d2 = state.camera.position.distanceToSquared(scratchItemPos.set(t.x, t.y, t.z));
    if (rb.isEnabled() && d2 > ITEM_FREEZE_DISTANCE * ITEM_FREEZE_DISTANCE) rb.setEnabled(false);
    else if (!rb.isEnabled() && d2 < ITEM_THAW_DISTANCE * ITEM_THAW_DISTANCE) rb.setEnabled(true);
  });

  useFrame(() => {
    if (rigidBody.current && !item.isPlanted) {
      const v = rigidBody.current.linvel();
      lastVel.current.set(v.x, v.y, v.z);

      // Entering water: rings and a splash sized by the speed it hits at.
      if (v.y < -1) {
        const t = rigidBody.current.translation();
        const surface = terrainRuntime.getSeaSurfaceYAtWorld(t.x, t.z);
        if (surface != null) {
          const above = t.y > surface;
          if (wasAboveWater.current && !above) {
            const strength = Math.min(1.6, -v.y / 7);
            addWaterRipple(t.x, t.z, 0.6 + strength);
            emitImpact({ position: new THREE.Vector3(t.x, surface, t.z), kind: 'water', color: '#d6e4e2', strength, floorY: surface });
          }
          wasAboveWater.current = above;
        } else {
          wasAboveWater.current = null;
        }
      } else if (wasAboveWater.current !== null) {
        wasAboveWater.current = null;
      }

      // OPTIMIZATION: Removed per-frame store sync of item.position.
      // The store position is now only updated when the item is planted or removed.
    }
  });

  const onCollisionEnter = (e: any) => {
    const impactSpeed = lastVel.current.length();
    const other = e.other.rigidBodyObject;
    const isTerrain = other?.userData?.type === 'terrain';
    const otherType = other?.userData?.type;
    const otherId = other?.userData?.id;

    const isStickBased = item.type === ItemType.STICK || (item.customToolData?.baseType === ItemType.STICK);

    // Helper to shatter a rock at a position (used for both self and target)
    const shatterRock = (position: { x: number; y: number; z: number }, targetId: string, targetType: ItemType = ItemType.STONE) => {
      // Removal is applied on the next React render; a second collision event in the
      // meantime must not shatter the same item again (that spawned 6 shards).
      if (shatteredItemIds.has(targetId)) return;
      shatteredItemIds.add(targetId);
      if (shatteredItemIds.size > 512) shatteredItemIds.clear(); // ids are unique; bound the set

      // A broken shard just breaks: spawning shards from shards multiplied them.
      const shardCount = targetType === ItemType.STONE ? 2 + (Math.random() < 0.5 ? 1 : 0) : 0;
      for (let i = 0; i < shardCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1.0 + Math.random() * 1.0;
        spawnItem(ItemType.SHARD, [position.x, position.y + 0.25, position.z], [Math.cos(a) * speed, 1.8 + Math.random(), Math.sin(a) * speed]);
      }
      const at = new THREE.Vector3(position.x, position.y, position.z);
      emitImpact({ position: at, kind: 'stone', color: '#8a867c', strength: targetType === ItemType.STONE ? 2 : 1, floorY: position.y - 0.1 });
      emitSpark(at);

      // Play shatter sound (NEW: using stone_hit.mp3)
      playSound('rock_hit', { pitch: 1.2, volume: 0.5 });

      // Remove the shattered rock
      removeItem(targetId);
    };

    if (item.type === ItemType.STONE) {
      // Check for item-to-item collision (rock hitting another rock or shard)
      const isOtherDamageable = otherType === ItemType.STONE || otherType === ItemType.SHARD;

      if (isOtherDamageable && otherId && impactSpeed > 4.0) {
        // Item-to-item collision - damage the target
        const dmg = impactSpeed / 6.0; // Slightly more damage for item impacts
        const damageStore = useEntityHistoryStore.getState();
        const targetHealth = damageStore.damageEntity(otherId, dmg, 10, 'Rock Impact');

        // Get target position from the collision
        const targetPos = other.position || e.other.rigidBody?.translation();

        if (targetHealth <= 0 && targetPos) {
          // Target shattered!
          shatterRock(targetPos, otherId, otherType);
        } else {
          // Impact sound (NEW: using stone_hit.mp3)
          const volume = Math.min(1.0, impactSpeed / 15);
          playSound('rock_hit', { pitch: 0.9 + Math.random() * 0.2, volume });
        }

        // Also damage the thrown stone (both rocks take damage on collision)
        const selfHealth = damageStore.damageEntity(item.id, dmg * 0.5, 10, 'Rock Impact');
        if (selfHealth <= 0 && rigidBody.current) {
          const t = rigidBody.current.translation();
          shatterRock(t, item.id);
        }
        return; // Don't process terrain collision if we hit an item
      }

      if (isTerrain && impactSpeed > 6.0) { // Lower threshold for damage
        // Only damage on hard terrain materials (avoid sand/soil shatter).
        const tSelf = rigidBody.current?.translation();
        if (!tSelf) return;
        const sample = new THREE.Vector3(tSelf.x, tSelf.y, tSelf.z);
        if (impactSpeed > 0.001) {
          const dirIntoSurface = lastVel.current.clone().normalize();
          sample.addScaledVector(dirIntoSurface, 0.25);
        }
        const mat = terrainRuntime.getMaterialAtWorld(sample.x, sample.y, sample.z);
        if (!isHardImpactSurface(mat)) return;

        // Damage calculation: more speed = more damage
        // Max speed around 24, so 24/8 = 3 damage per throw.
        const dmg = impactSpeed / 8.0;
        const damageStore = useEntityHistoryStore.getState();
        const h = damageStore.damageEntity(item.id, dmg, 10, 'Hard Stone');

        if (h <= 0) {
          // Shatter!
          const t = rigidBody.current!.translation();
          shatterRock(t, item.id);
        } else {
          // Just a clunk (NEW: using stone_hit.mp3)
          const volume = Math.min(1.0, impactSpeed / 20);
          playSound('rock_hit', { volume });
        }
      }
    }
    else if (isStickBased) {
      if (isTerrain && impactSpeed > IMPACT_THRESHOLD_STICK) {
        if (rigidBody.current) {
          const t = rigidBody.current.translation();

          // Precise grounding: Raycast down from slightly above the hit point
          const ray = new rapier.Ray({ x: t.x, y: t.y + 1.0, z: t.z }, { x: 0, y: -1, z: 0 });
          const hit = world.castRay(ray, 4.0, true, undefined, undefined, undefined, undefined, (c: any) => {
            return c.parent()?.userData?.type === 'terrain';
          });

          let targetY = t.y;
          if (hit) {
            const groundY = (t.y + 1.0) - hit.timeOfImpact;
            // The stick is 0.95 m long; bury about 0.2 m of it, so its
            // centre stands at groundY + (0.475 - 0.2).
            targetY = groundY + 0.275;
          } else {
            // Fallback if raycast misses
            targetY = t.y - 0.05;
          }

          // Lock physics behavior by updating the store.
          // The RigidBody type prop will switch to "fixed".
          updateItem(item.id, {
            isPlanted: true,
            position: [t.x, targetY, t.z] // Persist the grounded position
          });

          // Snapshot position and rotation immediately
          rigidBody.current.setTranslation({ x: t.x, y: targetY, z: t.z }, true);
          rigidBody.current.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          rigidBody.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          rigidBody.current.setAngvel({ x: 0, y: 0, z: 0 }, true);

          // Play planting sound (use random dig sound)
          playSound(Math.random() > 0.5 ? 'dig_1' : (Math.random() > 0.5 ? 'dig_2' : 'dig_3'));
        }
      }
    }
  };

  // Visuals
  return (
    <RigidBody
      key={`${item.id}-${item.isPlanted ? 'planted' : 'flying'}`}
      ref={rigidBody}
      position={item.position}
      rotation={item.isPlanted ? [0, 0, 0] : undefined}
      linearVelocity={item.velocity as any}
      colliders={false}
      type={(item.isPlanted || item.isAnchored) ? "fixed" : "dynamic"}
      ccd={!(item.isPlanted || item.isAnchored)}
      userData={{ type: item.type, id: item.id }}
      onCollisionEnter={onCollisionEnter}
      friction={0.8}
      restitution={0.2}
    >
      {/* Dynamic Visual Rendering */}
      {item.type !== ItemType.FIRE && (
        <>
          {item.type === ItemType.STONE && <CuboidCollider args={[0.22, 0.22, 0.22]} />}
          {/* 95 cm stick: capsule half-height + radius = half its length. */}
          {item.type === ItemType.STICK && <CapsuleCollider args={[0.43, 0.045]} />}
          {/* Matches the flake (22 x 10 x 4 cm), so it lies flat instead of half-sunk. */}
          {item.type === ItemType.SHARD && <CuboidCollider args={[0.045, 0.11, 0.02]} />}
          {item.type === ItemType.FLORA && <CuboidCollider args={[0.2, 0.2, 0.2]} />}
          {item.type === ItemType.PICKAXE && <CuboidCollider args={[0.3, 0.3, 0.3]} />}
          {item.type === ItemType.AXE && <CuboidCollider args={[0.3, 0.3, 0.3]} />}

          {/* Custom stick-based tools use the STICK capsule above (a second copy doubled their mass). */}

          <UniversalTool item={item.customToolData || item.type} />
        </>
      )}

      {item.type === ItemType.FIRE && (
        <>
          <CuboidCollider args={[0.4, 0.2, 0.4]} />
          <Campfire
            intensity={getItemMetadata(ItemType.FIRE)?.emissiveIntensity || 2.5}
            color="#ff9a4a" // amber firelight (the registry's #ff5500 turned grey stone pink)
          />
          <FireSound />
        </>
      )}
    </RigidBody>
  );
};

/**
 * FireSound - Spatial audio for campfires using drei's PositionalAudio.
 *
 * Uses Web Audio API's PannerNode for true 3D spatialization:
 * - refDistance: Radius where volume is 100% (5 units = ~5 meters)
 * - rolloffFactor: How quickly sound fades beyond refDistance
 * - maxDistance: Sound is silent beyond this distance
 * - distanceModel: "inverse" provides realistic falloff curve
 *
 * The sound automatically pans left/right based on player orientation
 * and attenuates based on distance from the fire.
 */
const FireSound: React.FC = () => {
  const audioRef = useRef<THREE.PositionalAudio>(null);

  useEffect(() => {
    // Auto-play when component mounts
    if (audioRef.current && !audioRef.current.isPlaying) {
      audioRef.current.play();
    }

    return () => {
      // Stop when component unmounts (fire destroyed)
      if (audioRef.current && audioRef.current.isPlaying) {
        audioRef.current.stop();
      }
    };
  }, []);

  return (
    <Suspense fallback={null}>
      <PositionalAudio
        ref={audioRef}
        url={fireUrl}
        distance={5}           // Full volume within 5 units
        loop
        autoplay
      />
    </Suspense>
  );
};
