import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

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

  // Particle system geometry
  const { geometry, initialPositions } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    const goldColor = new THREE.Color('#ffcc00');

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      // Start at tree position
      positions[i3] = position.x;
      positions[i3 + 1] = position.y;
      positions[i3 + 2] = position.z;

      // Golden glow with variation
      const variation = 0.8 + Math.random() * 0.4;
      colors[i3] = goldColor.r * variation;
      colors[i3 + 1] = goldColor.g * variation;
      colors[i3 + 2] = goldColor.b * variation;

      // Varying sizes
      sizes[i] = 0.1 + Math.random() * 0.15;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    return {
      geometry: geo,
      initialPositions: positions.slice()
    };
  }, [position.x, position.y, position.z]);

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

  useFrame((state, dt) => {
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

        // Fade size as particles near bee
        const baseSz = 0.1 + Math.random() * 0.15;
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
  React.useEffect(() => {
    if (active) {
      timeRef.current = 0;
      lifetimeRef.current = 0;
    }
  }, [active]);

  if (!active) return null;

  return (
    <group>
      <points ref={particlesRef} geometry={geometry} material={material}>
        <pointsMaterial ref={materialRef} attach="material" {...material} />
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
