import React, { useRef, useEffect, Suspense } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, CapsuleCollider, CuboidCollider, useRapier } from '@react-three/rapier';
import { PositionalAudio } from '@react-three/drei';
import * as THREE from 'three';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { ItemType, ActivePhysicsItem, MaterialType } from '@/types';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { getItemMetadata } from '../logic/ItemRegistry';
import { UniversalTool } from './UniversalTool';
import { useEntityHistoryStore } from '@/state/EntityHistoryStore';
import CustomShaderMaterial from 'three-custom-shader-material';

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

export const PhysicsItem: React.FC<PhysicsItemProps> = ({ item }) => {
  const rigidBody = useRef<RapierRigidBody>(null);
  const removeItem = usePhysicsItemStore((state) => state.removeItem);
  const spawnItem = usePhysicsItemStore((state) => state.spawnItem);
  const updateItem = usePhysicsItemStore((state) => state.updateItem);
  const { world, rapier } = useRapier();

  // Audio hooks replaced with shared pool references


  const lastVel = useRef(new THREE.Vector3());

  useFrame(() => {
    if (rigidBody.current && !item.isPlanted) {
      const v = rigidBody.current.linvel();
      lastVel.current.set(v.x, v.y, v.z);

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
    const shatterRock = (position: { x: number; y: number; z: number }, targetId: string) => {
      // Spawn 3 Shards
      for (let i = 0; i < 3; i++) {
        const vx = (Math.random() - 0.5) * 4;
        const vy = (Math.random() * 3) + 2;
        const vz = (Math.random() - 0.5) * 4;
        spawnItem(ItemType.SHARD, [position.x, position.y + 0.5, position.z], [vx, vy, vz]);
      }

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
          shatterRock(targetPos, otherId);
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
            // The stick is 0.5 units tall. To bury it by 0.15, 
            // the center should be at groundY + (halfHeight - buryDepth)
            // 0.25 - 0.15 = 0.1
            targetY = groundY + 0.1;
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
          {item.type === ItemType.STICK && <CapsuleCollider args={[0.25, 0.04]} />}
          {item.type === ItemType.SHARD && <CuboidCollider args={[0.08, 0.08, 0.08]} />}
          {item.type === ItemType.FLORA && <CuboidCollider args={[0.2, 0.2, 0.2]} />}
          {item.type === ItemType.PICKAXE && <CuboidCollider args={[0.3, 0.3, 0.3]} />}
          {item.type === ItemType.AXE && <CuboidCollider args={[0.3, 0.3, 0.3]} />}

          {/* Custom Tool (Stick-based) Collider Fallback */}
          {item.customToolData && item.type === ItemType.STICK && <CapsuleCollider args={[0.25, 0.04]} />}

          <UniversalTool item={item.customToolData || item.type} />
        </>
      )}

      {item.type === ItemType.FIRE && (
        <>
          <CuboidCollider args={[0.4, 0.2, 0.4]} />
          <group position={[0, 0.1, 0]}>
            <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 4, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.6]} />
              <meshStandardMaterial color="#3e2723" />
            </mesh>
            <mesh position={[0, 0.05, 0]} rotation={[0, -Math.PI / 4, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.6]} />
              <meshStandardMaterial color="#4e342e" />
            </mesh>
            <mesh position={[0, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.6]} />
              <meshStandardMaterial color="#5d4037" />
            </mesh>
          </group>
          <pointLight
            position={[0, 0.5, 0]}
            intensity={getItemMetadata(ItemType.FIRE)?.emissiveIntensity || 2.5}
            distance={10}
            color={getItemMetadata(ItemType.FIRE)?.emissive || "#ffaa00"}
            decay={2}
            castShadow={false}
          />
          <FireParticles />
          <FireSound />
        </>
      )}
    </RigidBody>
  );
};

const FireParticles: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const paramsAttr = useRef<THREE.InstancedBufferAttribute>(null);
  const offsetsAttr = useRef<THREE.InstancedBufferAttribute>(null);
  const COUNT = 30;

  const FIRE_VSHADER = `
    attribute vec3 aOffset;
    attribute vec4 aParams; 
    uniform float uTime;
    void main() {
        float startTime = aParams.x;
        float life = aParams.y;
        float speed = aParams.z;
        float baseScale = aParams.w;
        float t = mod(uTime + startTime, life);
        float progress = t / life;
        vec3 pos = aOffset;
        pos.y += t * speed;
        pos.x += sin(uTime * 5.0 + float(gl_InstanceID) * 0.5) * 0.008;
        pos.z += cos(uTime * 3.0 + float(gl_InstanceID) * 0.3) * 0.008;
        float size = (1.0 - progress) * 0.25 * baseScale;
        csm_Position = pos + csm_Position * size;
    }
  `;

  useEffect(() => {
    if (!paramsAttr.current || !offsetsAttr.current) return;
    for (let i = 0; i < COUNT; i++) {
      offsetsAttr.current.setXYZ(i, (Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3);
      paramsAttr.current.setXYZW(i, Math.random() * 2.0, 1.0 + Math.random() * 0.5, 0.4 + Math.random() * 0.8, 0.5 + Math.random() * 0.5);
    }
    paramsAttr.current.needsUpdate = true;
    offsetsAttr.current.needsUpdate = true;
  }, []);

  useFrame((state) => {
    if (glowRef.current) glowRef.current.scale.setScalar(1.0 + Math.sin(state.clock.elapsedTime * 8) * 0.1);
    if (meshRef.current) {
      const mat = meshRef.current.material as any;
      if (mat.uniforms) mat.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <group>
      <mesh ref={glowRef} position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial color="#ff5500" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]}>
          <instancedBufferAttribute ref={offsetsAttr} attach="attributes-aOffset" args={[new Float32Array(COUNT * 3), 3]} />
          <instancedBufferAttribute ref={paramsAttr} attach="attributes-aParams" args={[new Float32Array(COUNT * 4), 4]} />
        </boxGeometry>
        <CustomShaderMaterial
          baseMaterial={THREE.MeshBasicMaterial}
          vertexShader={FIRE_VSHADER}
          uniforms={{ uTime: { value: 0 } }}
          color={getItemMetadata(ItemType.FIRE)?.color || "#ffcc00"}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
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
