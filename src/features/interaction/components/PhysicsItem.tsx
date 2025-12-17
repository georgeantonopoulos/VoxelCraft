import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, CapsuleCollider, CuboidCollider, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { ItemType, ActivePhysicsItem, MaterialType } from '@/types';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';
import { STICK_SHADER, ROCK_SHADER } from '@core/graphics/GroundItemShaders';

// Sounds
import clunkUrl from '@/assets/sounds/clunk.wav?url';
import dig1Url from '@/assets/sounds/Dig_1.wav?url';

interface PhysicsItemProps {
  item: ActivePhysicsItem;
}

const IMPACT_THRESHOLD_STONE = 12.0;
const IMPACT_THRESHOLD_STICK = 5.0; // Lowered to make planting more reliable

const isHardImpactSurface = (mat: MaterialType | null): boolean => {
  // Only shatter stones when hitting hard/cavern-like materials.
  return mat === MaterialType.STONE || mat === MaterialType.BEDROCK || mat === MaterialType.MOSSY_STONE;
};

export const PhysicsItem: React.FC<PhysicsItemProps> = ({ item }) => {
  const rigidBody = useRef<RapierRigidBody>(null);
  const removeItem = usePhysicsItemStore((state) => state.removeItem);
  const spawnItem = usePhysicsItemStore((state) => state.spawnItem);
  const updateItem = usePhysicsItemStore((state) => state.updateItem);
  const { world, rapier } = useRapier();

  // Audio
  const clunkAudio = useMemo(() => new Audio(clunkUrl), []);
  const digAudio = useMemo(() => new Audio(dig1Url), []);


  const lastVel = useRef(new THREE.Vector3());

  useFrame(() => {
    if (rigidBody.current && !item.isPlanted) {
      const v = rigidBody.current.linvel();
      lastVel.current.set(v.x, v.y, v.z);

      // Sync position to store for persistence (optional, but good for "Q" pickup logic)
      const t = rigidBody.current.translation();
      item.position = [t.x, t.y, t.z];
    }
  });

  const onCollisionEnter = (e: any) => {
    if (item.isPlanted) {
      // Shard colliding with Planted Stick
      if (item.type === ItemType.STICK) {
        // I am a planted stick. Did a shard hit me?
        // "other" might be the terrain or a shard.
        // Check userData of other.
        const other = e.other.rigidBodyObject;
        if (other && other.userData?.type === ItemType.SHARD) {
          // CRAFTING EVENT!
          // Spawn Pickaxe
          const t = rigidBody.current!.translation();
          spawnItem(ItemType.PICKAXE, [t.x, t.y + 0.5, t.z], [0, 2, 0]);

          // Play Sound
          clunkAudio.currentTime = 0;
          clunkAudio.play().catch(() => { });

          // Remove Stick (me)
          removeItem(item.id);
          // Remove Shard (other) - Need its ID.
          // We can't easily get the ID from here unless we store it in userData.
          if (other.userData.id) {
            removeItem(other.userData.id);
          }
        }
      }
      return;
    }

    const impactSpeed = lastVel.current.length();
    const other = e.other.rigidBodyObject;
    const isTerrain = other?.userData?.type === 'terrain';

    if (item.type === ItemType.STONE) {
      if (isTerrain && impactSpeed > IMPACT_THRESHOLD_STONE) {
        // Only shatter on hard terrain materials (avoid sand/soil shatter).
        const tSelf = rigidBody.current?.translation();
        if (!tSelf) return;
        const sample = new THREE.Vector3(tSelf.x, tSelf.y, tSelf.z);
        if (impactSpeed > 0.001) {
          const dirIntoSurface = lastVel.current.clone().normalize();
          sample.addScaledVector(dirIntoSurface, 0.25);
        }
        const mat = terrainRuntime.getMaterialAtWorld(sample.x, sample.y, sample.z);
        if (!isHardImpactSurface(mat)) return;

        // Shatter!
        const t = rigidBody.current!.translation();

        // Spawn 3 Shards
        for (let i = 0; i < 3; i++) {
          const vx = (Math.random() - 0.5) * 4;
          const vy = (Math.random() * 3) + 2;
          const vz = (Math.random() - 0.5) * 4;
          spawnItem(ItemType.SHARD, [t.x, t.y + 0.2, t.z], [vx, vy, vz]);
        }

        // Play Sound
        clunkAudio.currentTime = 0;
        clunkAudio.volume = 0.5;
        clunkAudio.playbackRate = 1.2; // higher pitch for shatter
        clunkAudio.play().catch(() => { });

        // Remove self
        removeItem(item.id);
      }
    } else if (item.type === ItemType.STICK) {
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

          // Play sound
          digAudio.currentTime = 0;
          digAudio.play().catch(() => { });
        }
      }
    }
  };

  // Visuals
  return (
    <RigidBody
      ref={rigidBody}
      position={item.position}
      rotation={item.isPlanted ? [0, 0, 0] : undefined}
      linearVelocity={item.velocity as any}
      colliders={false} // Custom colliders
      type={(item.isPlanted || item.isAnchored) ? "fixed" : "dynamic"}
      ccd={!(item.isPlanted || item.isAnchored)}
      userData={{ type: item.type, id: item.id }}
      onCollisionEnter={onCollisionEnter}
      friction={0.8}
      restitution={0.2}
    >
      {item.type === ItemType.STONE && (
        <>
          <CuboidCollider args={[0.15, 0.15, 0.15]} />
          <mesh castShadow receiveShadow>
            <dodecahedronGeometry args={[0.15, 1]} />
            <CustomShaderMaterial
              baseMaterial={THREE.MeshStandardMaterial}
              vertexShader={ROCK_SHADER.vertex}
              uniforms={{
                uNoiseTexture: { value: noiseTexture },
                uSeed: { value: item.id.split('-').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 100 }
              }}
              color="#888888"
              roughness={0.9}
            />
          </mesh>
        </>
      )}

      {item.type === ItemType.STICK && (
        <>
          <CapsuleCollider args={[0.25, 0.04]} />
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.045, 0.04, 0.5, 8, 4]} />
            <CustomShaderMaterial
              baseMaterial={THREE.MeshStandardMaterial}
              vertexShader={STICK_SHADER.vertex}
              uniforms={{
                uSeed: { value: item.id.split('-').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 100 },
                uHeight: { value: 0.5 }
              }}
              color="#5d4037"
              roughness={1.0}
            />
          </mesh>
        </>
      )}

      {item.type === ItemType.SHARD && (
        <>
          {/* Small sharp collider */}
          <CuboidCollider args={[0.08, 0.08, 0.08]} />
          <mesh castShadow receiveShadow>
            <tetrahedronGeometry args={[0.12, 0]} />
            <meshStandardMaterial color="#aaaaaa" roughness={0.5} />
          </mesh>
        </>
      )}

      {item.type === ItemType.PICKAXE && (
        <>
          <CuboidCollider args={[0.3, 0.3, 0.3]} />
          <group rotation={[0, 0, -Math.PI / 4]}>
            {/* Handle */}
            <mesh position={[0, -0.2, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.6]} />
              <meshStandardMaterial color="#5d4037" />
            </mesh>
            {/* Head */}
            <mesh position={[0, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
              <boxGeometry args={[0.1, 0.5, 0.1]} />
              {/* Or Tetrahedron for sharp look */}
              <meshStandardMaterial color="#666666" />
            </mesh>
          </group>
        </>
      )}

      {item.type === ItemType.FIRE && (
        <>
          <CuboidCollider args={[0.4, 0.2, 0.4]} />
          {/* Logs */}
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

          {/* Fire Light */}
          <pointLight position={[0, 0.5, 0]} intensity={2.5} distance={10} color="#ffaa00" decay={2} castShadow />

          {/* Fire Visuals */}
          <FireParticles />
        </>
      )}

    </RigidBody>
  );
};

const FireParticles: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // Increase particle count for richer effect
  const COUNT = 30;

  const particles = useRef<{ pos: THREE.Vector3, vel: THREE.Vector3, scale: number, life: number, speed: number }[]>([]);

  useEffect(() => {
    // Init particles
    for (let i = 0; i < COUNT; i++) {
      particles.current.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.5, (Math.random() - 0.5) * 0.3),
        vel: new THREE.Vector3(0, Math.random() * 0.8 + 0.4, 0),
        scale: Math.random(),
        life: Math.random(),
        speed: 0.5 + Math.random() * 0.5
      });
    }
  }, []);

  useFrame((state, delta) => {
    // Animate Glow
    if (glowRef.current) {
      // Pulse scale
      const pulse = 1.0 + Math.sin(state.clock.elapsedTime * 8) * 0.1;
      glowRef.current.scale.setScalar(pulse);
      // Face camera (billboard) logic if needed, but for a sphere/glow it's omni.
      // Actually let's just make it a simple meshBasicMaterial sphere with low opacity
    }

    if (!meshRef.current) return;

    particles.current.forEach((p, i) => {
      p.life += delta * p.speed;

      // Reset loop
      if (p.life > 1.0) {
        p.life -= 1.0;
        // Reset to bottom center with some spread
        p.pos.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2);
        p.scale = 0.5 + Math.random() * 0.5;
        p.vel.y = Math.random() * 0.8 + 0.4;
      }

      // Physics
      p.pos.y += p.vel.y * delta;

      // Turbulent Wiggle
      const time = state.clock.elapsedTime;
      p.pos.x += Math.sin(time * 5 + i * 0.5) * 0.005;
      p.pos.z += Math.cos(time * 3 + i * 0.3) * 0.005;

      // Shrink and Color trick (via scale)
      const lifeFactor = 1.0 - p.life;
      const size = lifeFactor * 0.25 * p.scale;

      dummy.position.copy(p.pos);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* Core Glow */}
      <mesh ref={glowRef} position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial color="#ff5500" transparent opacity={0.3} depthWrite={false} />
      </mesh>

      {/* Particles */}
      <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffcc00" toneMapped={false} />
      </instancedMesh>
    </group>
  );
};
