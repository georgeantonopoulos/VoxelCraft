import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, RapierRigidBody, CapsuleCollider, CuboidCollider, useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { usePhysicsItemStore } from '@state/PhysicsItemStore';
import { ItemType, ActivePhysicsItem, MaterialType } from '@/types';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';
import { STICK_SHADER, ROCK_SHADER } from '@core/graphics/GroundItemShaders';
import { getItemColor, getItemMetadata } from '../logic/ItemRegistry';

// Sounds
import clunkUrl from '@/assets/sounds/clunk.wav?url';
import dig1Url from '@/assets/sounds/Dig_1.wav?url';

// Shared Audio Pool for performance
const CLUNK_AUDIO = new Audio(clunkUrl);
const DIG_AUDIO = new Audio(dig1Url);

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

          // Play Sound using shared pool
          CLUNK_AUDIO.currentTime = 0;
          CLUNK_AUDIO.play().catch(() => { });

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

        // Play Sound using shared pool
        CLUNK_AUDIO.currentTime = 0;
        CLUNK_AUDIO.volume = 0.5;
        CLUNK_AUDIO.playbackRate = 1.2; // higher pitch for shatter
        CLUNK_AUDIO.play().catch(() => { });

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

          // Play sound using shared pool
          DIG_AUDIO.currentTime = 0;
          DIG_AUDIO.play().catch(() => { });
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
              color={getItemColor(ItemType.STONE)}
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
              color={getItemColor(ItemType.STICK)}
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
            <meshStandardMaterial color={getItemColor(ItemType.SHARD)} roughness={0.5} />
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
              <meshStandardMaterial color={getItemColor(ItemType.STICK)} />
            </mesh>
            {/* Head */}
            <mesh position={[0, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
              <boxGeometry args={[0.1, 0.5, 0.1]} />
              {/* Or Tetrahedron for sharp look */}
              <meshStandardMaterial color={getItemColor(ItemType.PICKAXE)} />
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
          <pointLight
            position={[0, 0.5, 0]}
            intensity={getItemMetadata(ItemType.FIRE)?.emissiveIntensity || 2.5}
            distance={10}
            color={getItemMetadata(ItemType.FIRE)?.emissive || "#ffaa00"}
            decay={2}
            castShadow
          />

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
  const paramsAttr = useRef<THREE.InstancedBufferAttribute>(null);
  const offsetsAttr = useRef<THREE.InstancedBufferAttribute>(null);

  const COUNT = 30;

  const FIRE_VSHADER = `
    attribute vec3 aOffset;
    attribute vec4 aParams; // [startTime, life, speed, scale]
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
        
        // Turbulent Wiggle
        pos.x += sin(uTime * 5.0 + float(gl_InstanceID) * 0.5) * 0.008;
        pos.z += cos(uTime * 3.0 + float(gl_InstanceID) * 0.3) * 0.008;
        
        float lifeFactor = 1.0 - progress;
        float size = lifeFactor * 0.25 * baseScale;
        
        csm_Position = pos + csm_Position * size;
    }
  `;

  useEffect(() => {
    if (!paramsAttr.current || !offsetsAttr.current) return;
    for (let i = 0; i < COUNT; i++) {
      // Initial Offset
      offsetsAttr.current.setXYZ(i,
        (Math.random() - 0.5) * 0.3,
        Math.random() * 0.2,
        (Math.random() - 0.5) * 0.3
      );

      // Params: [startTime, life, speed, scale]
      paramsAttr.current.setXYZW(i,
        Math.random() * 2.0,
        1.0 + Math.random() * 0.5,
        0.4 + Math.random() * 0.8,
        0.5 + Math.random() * 0.5
      );
    }
    paramsAttr.current.needsUpdate = true;
    offsetsAttr.current.needsUpdate = true;
  }, []);

  useFrame((state) => {
    if (glowRef.current) {
      const pulse = 1.0 + Math.sin(state.clock.elapsedTime * 8) * 0.1;
      glowRef.current.scale.setScalar(pulse);
    }

    if (meshRef.current) {
      const mat = meshRef.current.material as any;
      if (mat.uniforms) {
        mat.uniforms.uTime.value = state.clock.elapsedTime;
      }
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
