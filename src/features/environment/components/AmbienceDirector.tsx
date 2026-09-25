import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioManager } from '@core/audio/AudioManager';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { BiomeManager, BiomeType } from '@features/terrain/logic/BiomeManager';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { WATER_LEVEL } from '@/constants';

/**
 * AmbienceDirector: headless. Measures what surrounds the camera (biome, water,
 * exposure, time of day, caves) and feeds ProceduralAmbience a few times per
 * second. All terrain queries are throttled; nothing runs per frame except a
 * timer check.
 */

/** Vegetation and bird population per biome (0..1). */
const BIOME_LIFE: Record<BiomeType, { foliage: number; birds: number }> = {
  THE_GROVE: { foliage: 0.8, birds: 0.9 },
  JUNGLE: { foliage: 1.0, birds: 1.0 },
  PLAINS: { foliage: 0.4, birds: 0.7 },
  SAVANNA: { foliage: 0.3, birds: 0.5 },
  MOUNTAINS: { foliage: 0.2, birds: 0.3 },
  BEACH: { foliage: 0.1, birds: 0.4 },
  DESERT: { foliage: 0.05, birds: 0.1 },
  RED_DESERT: { foliage: 0.05, birds: 0.1 },
  SNOW: { foliage: 0.1, birds: 0.15 },
  ICE_SPIKES: { foliage: 0.0, birds: 0.05 },
  SKY_ISLANDS: { foliage: 0.4, birds: 0.6 },
};

const PROBE_INTERVAL_S = 0.5;
/** Water sampling rings (metres) and directions per ring. */
const WATER_RINGS = [6, 16, 32];
const WATER_DIRS = 8;

export const AmbienceDirector: React.FC = () => {
  const timer = useRef(0);
  const lastSunY = useRef(0);
  const smooth = useRef({ water: 0, foliage: 0.5, birds: 0.5 });

  useFrame((state, delta) => {
    timer.current += delta;
    if (timer.current < PROBE_INTERVAL_S) return;
    timer.current = 0;

    const p = state.camera.position;
    const env = useEnvironmentStore.getState();

    // Time of day. Dawn = low sun that is rising.
    const sunY = sharedUniforms.uSunDir.value.y;
    const rising = sunY > lastSunY.current;
    lastSunY.current = sunY;
    const daylight = THREE.MathUtils.smoothstep(sunY, -0.08, 0.2);
    const dawn = rising ? Math.max(0, 1 - Math.abs(sunY - 0.08) / 0.2) : 0;

    // Biome life and climate heat.
    const biome = BiomeManager.getBiomeAt(p.x, p.z);
    const life = BIOME_LIFE[biome] ?? { foliage: 0.4, birds: 0.5 };
    const climate = BiomeManager.getClimate(p.x, p.z);
    const heat = THREE.MathUtils.clamp((climate.temp + 0.1) / 0.8, 0, 1);

    // Water proximity: fraction of nearby columns below sea level, nearer counts more.
    let wet = 0, total = 0;
    for (let r = 0; r < WATER_RINGS.length; r++) {
      const radius = WATER_RINGS[r];
      const weight = 1 / (1 + r);
      for (let k = 0; k < WATER_DIRS; k++) {
        const a = (k / WATER_DIRS) * Math.PI * 2 + r * 0.4;
        const h = TerrainService.getHeightAt(p.x + Math.cos(a) * radius, p.z + Math.sin(a) * radius);
        if (h < WATER_LEVEL - 0.3) wet += weight;
        total += weight;
      }
    }
    const waterNear = total > 0 ? wet / total : 0;
    // Hearing range falls off with height above the water surface.
    const waterHeard = waterNear * THREE.MathUtils.clamp(1 - (p.y - WATER_LEVEL - 2) / 40, 0, 1);
    const sea = climate.continent < -0.15;

    // Exposure: height above surroundings and openness.
    const ground = TerrainService.getHeightAt(p.x, p.z);
    const altitude = THREE.MathUtils.clamp((p.y - 10) / 70, 0, 1);
    const aboveGround = THREE.MathUtils.clamp((p.y - ground) / 12, 0, 1);
    const exposure = THREE.MathUtils.clamp(0.5 * altitude + 0.3 * (1 - life.foliage) + 0.2 * aboveGround, 0, 1);

    // Smooth biome-driven values so crossing a border fades rather than switches.
    const sm = smooth.current;
    sm.water += (waterHeard - sm.water) * 0.35;
    sm.foliage += (life.foliage - sm.foliage) * 0.2;
    sm.birds += (life.birds - sm.birds) * 0.2;

    audioManager.ambience.setScene({
      daylight,
      dawn,
      underground: env.undergroundBlend,
      underwater: env.underwaterBlend,
      foliage: sm.foliage,
      birdLife: sm.birds,
      heat,
      water: sm.water,
      sea,
      exposure,
    });
  });

  return null;
};
