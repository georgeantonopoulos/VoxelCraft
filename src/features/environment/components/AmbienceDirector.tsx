import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioManager } from '@core/audio/AudioManager';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { BiomeManager, BiomeType } from '@features/terrain/logic/BiomeManager';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { WATER_LEVEL, CHUNK_SIZE_XZ } from '@/constants';
import { chunkDataManager } from '@core/terrain/ChunkDataManager';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import type { LeafSource } from '@core/audio/ambience/ProceduralAmbience';

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

/** How much each tree type rustles (needles hiss softly, cacti are silent). */
const RUSTLE_BY_TYPE: Record<number, number> = {
  [TreeType.OAK]: 1.0,
  [TreeType.PINE]: 0.55,
  [TreeType.PALM]: 0.8,
  [TreeType.JUNGLE]: 1.0,
  [TreeType.ACACIA]: 0.75,
  [TreeType.CACTUS]: 0,
};
/** Trees farther than this are not heard individually. */
const LEAF_HEAR_RADIUS = 30;

const scratchForward = new THREE.Vector3();

/** Nearest rustling trees around (x, z), nearest first, plus a 0..1 density of trees within the radius. */
function nearbyTrees(x: number, y: number, z: number): { sources: LeafSource[]; density: number } {
  const cx = Math.floor(x / CHUNK_SIZE_XZ), cz = Math.floor(z / CHUNK_SIZE_XZ);
  const found: (LeafSource & { d2: number })[] = [];
  let weighted = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const chunk = chunkDataManager.getChunk(`${cx + dx},${cz + dz}`);
      const trees = chunk?.treePositions;
      if (!trees) continue;
      const ox = (cx + dx) * CHUNK_SIZE_XZ, oz = (cz + dz) * CHUNK_SIZE_XZ;
      for (let i = 0; i + 4 < trees.length; i += 5) {
        const strength = RUSTLE_BY_TYPE[trees[i + 3]] ?? 0.8;
        if (strength <= 0) continue;
        const tx = trees[i] + ox, tz = trees[i + 2] + oz;
        const d2 = (tx - x) * (tx - x) + (tz - z) * (tz - z);
        if (d2 > LEAF_HEAR_RADIUS * LEAF_HEAR_RADIUS) continue;
        const scale = trees[i + 4] || 1;
        // The crown, not the trunk base, is where the leaves are.
        const crownY = trees[i + 1] + 6 * scale;
        // Trees far above or below (cliffs, caves) are heard less.
        const dy = Math.abs(crownY - y);
        const s = strength * THREE.MathUtils.clamp(1 - (dy - 8) / 30, 0.2, 1);
        found.push({ x: tx, y: crownY, z: tz, strength: s, d2 });
        weighted += s * (1 - Math.sqrt(d2) / LEAF_HEAR_RADIUS);
      }
    }
  }
  found.sort((a, b) => a.d2 - b.d2);
  return { sources: found, density: THREE.MathUtils.clamp(weighted / 8, 0, 1) };
}
/** Water sampling rings (metres) and directions per ring. */
const WATER_RINGS = [6, 16, 32];
const WATER_DIRS = 8;

export const AmbienceDirector: React.FC = () => {
  const timer = useRef(0);
  const lastSunY = useRef(0);
  const smooth = useRef({ water: 0, foliage: 0.5, birds: 0.5 });

  useFrame((state, delta) => {
    // The listener follows the camera every frame so positioned sounds pan correctly.
    const cam = state.camera;
    cam.getWorldDirection(scratchForward);
    audioManager.ambience.setListener(cam.position.x, cam.position.y, cam.position.z, scratchForward.x, scratchForward.y, scratchForward.z);

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
    // Foliage = trees actually around the player (not the biome's average).
    const trees = nearbyTrees(p.x, p.y, p.z);
    audioManager.ambience.setLeafSources(env.undergroundBlend > 0.6 ? [] : trees.sources);
    sm.foliage += (trees.density - sm.foliage) * 0.3;
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
