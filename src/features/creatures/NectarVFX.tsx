import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/*
 * ===========================================================================
 * NECTAR VFX - CONNECTION MAP & ASSUMPTIONS
 * ===========================================================================
 *
 * CONNECTIONS TO OTHER FILES:
 * ----------------------------
 * 1. BeeManager.tsx (src/features/creatures/BeeManager.tsx)
 *    - TODO: NOT YET INTEGRATED - BeeManager has handleHarvest but doesn't spawn NectarVFX
 *    - TODO: BeeManager needs to maintain a list of active NectarVFX instances
 *    - TODO: When bee's onHarvest fires, spawn NectarVFX from tree to bee position
 *
 * 2. LumabeeCharacter.tsx (src/features/creatures/LumabeeCharacter.tsx)
 *    - Provides harvest position via onHarvest callback
 *    - Bee position updates each frame - NectarVFX target should track bee
 *
 * HOW TO INTEGRATE:
 * -----------------
 * In BeeManager.tsx:
 *   1. Add state: const [vfxInstances, setVfxInstances] = useState<VFXInstance[]>([])
 *   2. In handleHarvest, add: setVfxInstances(prev => [...prev, { id, treePos, beePos }])
 *   3. Render: {vfxInstances.map(vfx => <NectarVFX key={vfx.id} ... />)}
 *   4. Handle onComplete to remove from list
 *
 * ===========================================================================
 */

interface NectarVFXProps {
  position: THREE.Vector3;
  target: THREE.Vector3; // Where nectar flows to (usually the bee)
  active: boolean;
  onComplete?: () => void;
}

/**
 * NectarVFX - Visual effect for nectar extraction from trees
 *
 * Features:
 * - Particle stream from tree to bee
 * - Glowing trail effect
 * - Pulsing emissive light
 * - Automatic lifecycle (fades in/out)
 * - Proper GPU resource disposal
 * - Deterministic particle sizing
 */
export const NectarVFX: React.FC<NectarVFXProps> = ({
  position,
  target,
  active,
  onComplete
}) => {
  const particlesRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const timeRef = useRef(0);
  const lifetimeRef = useRef(0);

  const particleCount = 50;
  const lifetime = 2.0; // seconds

  // Deterministic particle size based on index (golden ratio distribution)
  const getParticleSize = (i: number): number => {
    const phi = 1.618033988749895;
    return 0.1 + ((i * phi) % 1.0) * 0.1; // Size range: 0.1 to 0.2
  };

  // Particle system geometry
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3); // Fixed: was particleCount, needs *3 for RGB
    const sizes = new Float32Array(particleCount);

    const goldColor = new THREE.Color('#ffcc00');

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      // Start at tree position
      positions[i3] = position.x;
      positions[i3 + 1] = position.y;
      positions[i3 + 2] = position.z;

      // Golden glow with deterministic variation (use index-based, not random)
      const phi = 1.618033988749895;
      const variation = 0.8 + ((i * phi) % 1.0) * 0.4;
      colors[i3] = goldColor.r * variation;
      colors[i3 + 1] = goldColor.g * variation;
      colors[i3 + 2] = goldColor.b * variation;

      // Initialize sizes
      sizes[i] = getParticleSize(i);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    return geo;
  }, [position.x, position.y, position.z]);

  // Dispose geometry on unmount to prevent GPU memory leak
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });
  }, []);

  // Dispose material on unmount to prevent GPU memory leak
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((_state, dt) => {
    if (!active) return;
    if (!particlesRef.current) return;

    timeRef.current += dt;
    lifetimeRef.current += dt;

    // Auto-complete after lifetime
    if (lifetimeRef.current > lifetime) {
      onComplete?.();
      lifetimeRef.current = 0;
      timeRef.current = 0;
      return;
    }

    const positions = geometry.attributes.position.array as Float32Array;
    const sizes = geometry.attributes.size.array as Float32Array;

    // Animate particles from tree to bee
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;

      // Staggered particle flow
      const particlePhase = (i / particleCount) * 0.5;
      const t = Math.min(1.0, (timeRef.current - particlePhase) / 0.8);

      if (t >= 0) {
        // Smooth curve from tree to bee
        const x = THREE.MathUtils.lerp(position.x, target.x, t);
        const y = THREE.MathUtils.lerp(position.y, target.y, t)
          + Math.sin(t * Math.PI) * 0.5; // Arc trajectory
        const z = THREE.MathUtils.lerp(position.z, target.z, t);

        // Add spiral motion
        const spiralRadius = 0.3 * (1 - t);
        const spiralAngle = timeRef.current * 5.0 + i * 0.5;
        positions[i3] = x + Math.cos(spiralAngle) * spiralRadius;
        positions[i3 + 1] = y + Math.sin(timeRef.current * 8.0 + i) * 0.1;
        positions[i3 + 2] = z + Math.sin(spiralAngle) * spiralRadius;

        // Fade size as particles near bee (deterministic)
        const baseSz = getParticleSize(i);
        sizes[i] = baseSz * (1 - t * 0.7);
      } else {
        // Particle not yet spawned
        positions[i3] = position.x;
        positions[i3 + 1] = position.y;
        positions[i3 + 2] = position.z;
        sizes[i] = 0;
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;

    // Fade material opacity
    if (materialRef.current) {
      const fadeIn = Math.min(1.0, lifetimeRef.current / 0.3);
      const fadeOut = Math.max(0.0, 1.0 - (lifetimeRef.current - (lifetime - 0.5)) / 0.5);
      materialRef.current.opacity = 0.8 * fadeIn * fadeOut;
    }
  });

  // Reset when active changes
  useEffect(() => {
    if (active) {
      timeRef.current = 0;
      lifetimeRef.current = 0;
    }
  }, [active]);

  if (!active) return null;

  return (
    <group>
      <points ref={particlesRef} geometry={geometry}>
        <pointsMaterial
          ref={materialRef}
          size={0.15}
          vertexColors
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      {/* Glowing point light at extraction point */}
      <pointLight
        position={[position.x, position.y, position.z]}
        intensity={1.5}
        distance={4.0}
        color="#ffcc00"
        decay={2}
      />

      {/* Glowing point light at bee (target) */}
      <pointLight
        position={[target.x, target.y, target.z]}
        intensity={0.8}
        distance={2.0}
        color="#ffcc00"
        decay={2}
      />
    </group>
  );
};
