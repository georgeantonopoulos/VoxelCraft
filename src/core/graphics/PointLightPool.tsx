import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Point light pool.
 *
 * three.js compiles every lit shader for a specific number of point lights.
 * When lights mount/unmount (chunks streaming, torches placed, swarms
 * spawning) or toggle `visible`, every lit material recompiles — visible as
 * hitches while walking. The pool keeps a CONSTANT number of real lights and
 * assigns them each tick to the most relevant registered virtual lights.
 *
 * Use <PooledPointLight> exactly like <pointLight>. Its ref exposes the
 * fields gameplay code animates (intensity, color, distance, decay, visible,
 * position), so existing `lightRef.current.intensity = ...` code keeps working.
 */

export const POOLED_LIGHT_COUNT = 12;
/** Re-rank virtual lights at this interval (seconds). Values sync every frame. */
const RANK_INTERVAL_S = 0.15;

export interface VirtualPointLight {
  intensity: number;
  color: THREE.Color;
  distance: number;
  decay: number;
  visible: boolean;
  /** Local offset from the anchor (mirrors <pointLight position>). */
  position: THREE.Vector3;
  /** Scene object whose world matrix positions this light. */
  anchor: THREE.Object3D | null;
  /** World position, refreshed by the pool. */
  world: THREE.Vector3;
}

const registry = new Set<VirtualPointLight>();

export const PointLightPool: React.FC = () => {
  const lights = useMemo(() => Array.from({ length: POOLED_LIGHT_COUNT }, () => {
    const l = new THREE.PointLight(0xffffff, 0, 1, 2);
    l.castShadow = false;
    return l;
  }), []);
  const assigned = useRef<Array<VirtualPointLight | null>>(Array(POOLED_LIGHT_COUNT).fill(null));
  const rankTimer = useRef(RANK_INTERVAL_S);
  const scratch = useMemo(() => ({ ranked: [] as Array<{ v: VirtualPointLight; score: number }> }), []);

  useFrame((state, delta) => {
    const cam = state.camera.position;

    rankTimer.current += delta;
    if (rankTimer.current >= RANK_INTERVAL_S) {
      rankTimer.current = 0;
      const ranked = scratch.ranked;
      ranked.length = 0;
      for (const v of registry) {
        if (!v.visible || v.intensity <= 0 || !v.anchor) continue;
        v.anchor.updateWorldMatrix(true, false);
        v.world.copy(v.position).applyMatrix4(v.anchor.matrixWorld);
        const d2 = v.world.distanceToSquared(cam);
        const reach = v.distance > 0 ? v.distance : 30;
        // Lights whose reach cannot touch the camera's surroundings rank last.
        if (d2 > (reach + 40) * (reach + 40)) continue;
        ranked.push({ v, score: d2 / (v.intensity * reach * reach + 1e-3) });
      }
      ranked.sort((a, b) => a.score - b.score);
      for (let i = 0; i < POOLED_LIGHT_COUNT; i++) assigned.current[i] = ranked[i]?.v ?? null;
    }

    for (let i = 0; i < POOLED_LIGHT_COUNT; i++) {
      const light = lights[i];
      const v = assigned.current[i];
      if (!v || !registry.has(v) || !v.visible || !v.anchor) {
        light.intensity = 0;
        continue;
      }
      v.anchor.updateWorldMatrix(true, false);
      light.position.copy(v.position).applyMatrix4(v.anchor.matrixWorld);
      light.intensity = v.intensity;
      light.color.copy(v.color);
      light.distance = v.distance;
      light.decay = v.decay;
    }
  });

  return (
    <>
      {lights.map((l, i) => <primitive key={i} object={l} />)}
    </>
  );
};

export interface PooledPointLightProps {
  position?: [number, number, number] | THREE.Vector3;
  color?: THREE.ColorRepresentation;
  intensity?: number;
  distance?: number;
  decay?: number;
  visible?: boolean;
  /** Accepted for <pointLight> compatibility; pooled lights never cast shadows. */
  castShadow?: boolean;
}

/** Drop-in replacement for <pointLight> that borrows a light from the pool. */
export const PooledPointLight = forwardRef<VirtualPointLight, PooledPointLightProps>(function PooledPointLight(
  { position, color = '#ffffff', intensity = 1, distance = 0, decay = 2, visible = true },
  ref
) {
  const anchorRef = useRef<THREE.Group>(null);
  const virtual = useMemo<VirtualPointLight>(() => ({
    intensity, color: new THREE.Color(color), distance, decay, visible,
    position: new THREE.Vector3(), anchor: null, world: new THREE.Vector3(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Like R3F, apply a prop only when it changes, so imperative animation via
  // the ref (lightRef.current.intensity = ...) survives unrelated re-renders.
  const last = useRef<Record<string, unknown>>({});
  const changed = (key: string, value: unknown) => {
    if (last.current[key] === value) return false;
    last.current[key] = value;
    return true;
  };
  if (changed('intensity', intensity)) virtual.intensity = intensity;
  if (changed('distance', distance)) virtual.distance = distance;
  if (changed('decay', decay)) virtual.decay = decay;
  if (changed('visible', visible)) virtual.visible = visible;
  if (changed('color', typeof color === 'object' ? (color as THREE.Color).getHex?.() ?? color : color)) virtual.color.set(color);
  const px = position instanceof THREE.Vector3 ? position.x : position?.[0] ?? 0;
  const py = position instanceof THREE.Vector3 ? position.y : position?.[1] ?? 0;
  const pz = position instanceof THREE.Vector3 ? position.z : position?.[2] ?? 0;
  if (changed('px', px) || changed('py', py) || changed('pz', pz)) virtual.position.set(px, py, pz);

  useImperativeHandle(ref, () => virtual, [virtual]);

  useEffect(() => {
    virtual.anchor = anchorRef.current;
    registry.add(virtual);
    return () => {
      registry.delete(virtual);
      virtual.anchor = null;
    };
  }, [virtual]);

  return <group ref={anchorRef} />;
});

// Debug: window.__lightPool.stats() -> registered virtual lights vs. real slots.
if (typeof window !== 'undefined') {
  (window as unknown as { __lightPool?: { stats: () => { registered: number; slots: number } } }).__lightPool = {
    stats: () => ({ registered: registry.size, slots: POOLED_LIGHT_COUNT }),
  };
}
