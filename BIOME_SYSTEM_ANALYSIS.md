# Biome System Analysis

A thorough inspection of VoxelCraft's biome generation system, from seed to surface.

---

## Executive Summary

The current biome system is **functional but underutilizes its foundations**. The infrastructure for a rich, realistic world is partially in place (4 noise layers, climate interpolation, continentalness), but several key areas lack depth or coherent implementation. This document identifies specific gaps and opportunities for growth.

---

## 1. Seed & Noise Foundation

### Current State

| Component | Location | Notes |
|-----------|----------|-------|
| Perlin 3D noise | `src/core/math/noise.ts` | Fixed permutation table with hardcoded seed `1337` |
| Simplex 2D noise | `BiomeManager.ts` | Uses `fast-simplex-noise` library, seeded per-layer |
| World seed | `BiomeManager.seed = 1337` | **Hardcoded, not configurable** |

### How It Works

```typescript
// noise.ts - Deterministic Perlin (3D)
let seedVal = 1337;
function seededRandom() {
    const x = Math.sin(seedVal++) * 10000;
    return x - Math.floor(x);
}
```

The Perlin noise uses a **one-time shuffled permutation table** initialized at module load. This is deterministic but the seed is not exposed to the user.

The BiomeManager creates 4 separate 2D Simplex noise functions:
1. **Temperature** (seed + 1)
2. **Humidity** (seed + 2)
3. **Continentalness** (seed + 3)
4. **Erosion** (seed + 4)

### Issues & Opportunities

| Issue | Severity | Details |
|-------|----------|---------|
| **Hardcoded world seed** | High | `seed = 1337` in BiomeManager cannot be changed at runtime or configured per-world. Players always see the same world layout. |
| **Perlin seed disconnected** | Medium | `noise.ts` uses its own `seedVal = 1337`, separate from BiomeManager. No guarantee they stay synchronized if one changes. |
| **No seed persistence** | High | WorldDB stores chunk modifications but not the world seed. New sessions recreate the same world by accident, not by design. |
| **Noise scale constants are reasonable** | - | TEMP_SCALE=0.0008, HUMID_SCALE=0.0008, CONT_SCALE=0.0005, EROSION_SCALE=0.001 produce continent-scale features (~1-2km biomes). |

### Recommendation

```typescript
// Proposed: Unified seed system
export class WorldSeed {
    static value: number = Date.now();  // Or from URL param / save file

    static setSeed(seed: number) {
        this.value = seed;
        // Re-initialize all noise functions
        BiomeManager.reinitialize(seed);
        reinitializePerlinTable(seed);
    }
}
```

---

## 2. Climate System

### Current Implementation

The climate model uses a **pseudo-realistic approach** with 4 factors:

```
Temperature = (Latitude * 0.7) + (Noise * 0.3)
Humidity = Pure noise
Continentalness = Controls ocean vs land
Erosion = Controls flatness vs mountainousness
```

#### Latitude Effect
```typescript
const latitude = -z * this.LATITUDE_SCALE;  // 0.0002
let baseTemp = latitude;
```
Moving in -Z direction (north) makes it colder. 5000 blocks = 1.0 temperature change.

### Climate Space (Illustrated)

```
             HUMID
               +
               |
    ICE_SPIKES |  JUNGLE
               |
COLD ---------+--------- HOT
               |
         SNOW  |  SAVANNA/RED_DESERT
               |
               -
             DRY
```

### Biome Selection Logic

The `getBiomeFromClimate()` function uses simple threshold checks:

| Temp Range | Humid > 0.5 | Humid -0.5 to 0.5 | Humid < -0.5 |
|------------|-------------|-------------------|--------------|
| < -0.5 (Cold) | ICE_SPIKES | SNOW | SNOW |
| -0.5 to 0.5 (Temperate) | JUNGLE | THE_GROVE | PLAINS |
| > 0.5 (Hot) | JUNGLE | SAVANNA | RED_DESERT |

### Issues & Opportunities

| Issue | Severity | Details |
|-------|----------|---------|
| **DESERT biome defined but never assigned** | High | `BiomeType` includes 'DESERT' but `getBiomeFromClimate()` never returns it. Hot+Dry returns RED_DESERT instead. |
| **MOUNTAINS biome defined but never assigned** | High | Listed in BiomeType but no path in climate logic produces it. Only referenced in vegetation/cave configs. |
| **Limited cold variation** | Medium | Cold+Dry and Cold+Mid both return SNOW. No TUNDRA, TAIGA, or FROZEN_PLAINS distinction. |
| **Temperate+Wet = JUNGLE** | Medium | Semantically odd. Should be SWAMP or TEMPERATE_RAINFOREST. Actual jungle should require Hot+Wet. |
| **No altitude influence on biome** | Medium | Mountains at Y=80 get same biome as lowlands. Could shift toward alpine biomes at height. |
| **Continentalness underutilized for biome selection** | Medium | Only used for BEACH detection and height modification, not for biome variety (e.g., coastal vs interior forests). |

### Beach Detection (The Good Part)

The BEACH biome intercept is well-designed:

```typescript
const isCoastal = continent > -0.25 && continent < 0.20;
const isFlat = erosion01 < 0.50;
const isNotFrozen = baseBiome !== 'SNOW' && baseBiome !== 'ICE_SPIKES';

if (isCoastal && isFlat && isNotFrozen) return 'BEACH';
```

This shows **physical-reality-based selection** works. Could be extended to:
- Cliffs (coastal + NOT flat)
- Fjords (cold + coastal + steep)
- River deltas (inland + flat + wet)

---

## 3. Terrain Generation

### Height Calculation

The terrain height uses a **bilinear interpolation** approach based on climate:

```typescript
// 4 corner archetypes
pColdDry = { baseHeight: 18, amp: 6,  freq: 1.0, warp: 10 };  // Tundra
pColdWet = { baseHeight: 35, amp: 40, freq: 2.0, warp: 15 };  // Ice Spikes
pHotDry  = { baseHeight: 10, amp: 10, freq: 0.8, warp: 5  };  // Desert
pHotWet  = { baseHeight: 25, amp: 30, freq: 1.5, warp: 25 };  // Jungle
```

Then modified by Continentalness:
- `continent < -0.3`: Ocean (height -= 24 to 45, amp *= 0.3)
- `-0.3 < continent < 0.1`: Coast transition (lerp)
- `continent > 0.1`: Land (slight rise inland)

And Erosion:
- `e < 0.3`: Flatlands (amp *= 0.5)
- `e > 0.7`: Mountains (amp *= 1.6, height += 6)

### Domain Warping

```typescript
const qx = noise3D(wx * 0.008, 0, wz * 0.008) * warp;
const qz = noise3D(wx * 0.008 + 5.2, 0, wz * 0.008 + 1.3) * warp;
const px = wx + qx;
const pz = wz + qz;
```

This creates **organic, non-grid-aligned features** - a good technique that's working well.

### Issues & Opportunities

| Issue | Severity | Details |
|-------|----------|---------|
| **No height octaves** | Medium | Uses single noise sample for height. No fractal/octave layering for realistic terrain variety at multiple scales. |
| **Erosion affects amplitude but not frequency** | Low | Mountain areas don't get sharper features. Real mountains have more high-frequency detail. |
| **No biome-specific terrain features** | Medium | Mesas (desert), volcanic cones (jungle), moraines (cold), karst (limestone) could all be procedural. |
| **Y-constant climate in column** | - | Column uses same continent/erosion. This is correct (no vertical climate zones implemented yet). |

### Cave System

Caves use a **tube algorithm** (2D noise distance field):

```typescript
const noiseA = noise3D(warpX * scale, wy * scale * 1.5, warpZ * scale);
const noiseB = noise3D(...offset...);
const tunnelVal = Math.sqrt(noiseA^2 + noiseB^2);
const sdf = (tunnelVal - threshold) * 50.0;
```

Biome-specific cave settings exist and are well-tuned:

| Biome | Scale | Threshold | Breach Chance |
|-------|-------|-----------|---------------|
| PLAINS | 0.035 | 0.15 | 0.15 |
| MOUNTAINS | 0.05 | 0.10 | 0.80 |
| JUNGLE | 0.035 | 0.15 | 0.35 |
| SKY_ISLANDS | 0.015 | 0.00 | 0.00 (no caves) |

---

## 4. Material Assignment

### Surface Materials

```typescript
static getSurfaceMaterial(biome: BiomeType): MaterialType {
    switch (biome) {
        case 'BEACH': return MaterialType.SAND;
        case 'JUNGLE': return MaterialType.JUNGLE_GRASS;
        case 'SNOW': return MaterialType.SNOW;
        // ...
    }
}
```

### Underground Materials

```typescript
static getUndergroundMaterials(biome: BiomeType): { primary, secondary } {
    switch (biome) {
        case 'JUNGLE': return { MOSSY_STONE, STONE };
        case 'DESERT': return { TERRACOTTA, SAND };
        case 'ICE_SPIKES': return { ICE, SNOW };
        // ...
    }
}
```

### Lumina Depths (Deep Underground)

Below Y=-20 and >15 blocks from surface:
- OBSIDIAN base
- GLOW_STONE veins (noise > 0.6)
- Unique flora spawns on these materials

### Issues & Opportunities

| Issue | Severity | Details |
|-------|----------|---------|
| **Only 16 materials** | Low | Sufficient for now but MaterialType enum could expand for biome variety (PEAT, GRAVEL, PACKED_ICE, CORAL_STONE). |
| **No ore/resource biome correlation** | Medium | No iron-rich mountains, no copper beaches, no coal in swamps. All underground is uniform. |
| **Soil depth is noise-based, not biome-based** | Low | `soilDepth = 6.0 + noise * 3.0` regardless of biome. Deserts could have shallower soil, jungles deeper. |

---

## 5. Vegetation System

### Vegetation Types

```typescript
enum VegetationType {
    GRASS_LOW, GRASS_TALL, FLOWER_BLUE, DESERT_SHRUB,
    SNOW_GRASS, JUNGLE_FERN, JUNGLE_GRASS, GROVE_GRASS,
    JUNGLE_BROADLEAF, JUNGLE_FLOWER, JUNGLE_VINE, JUNGLE_GIANT_FERN
}
```

### Tree Types

```typescript
enum TreeType {
    OAK, PINE, PALM, JUNGLE, ACACIA, CACTUS
}
```

### Biome-to-Flora Mapping

| Biome | Vegetation | Trees |
|-------|------------|-------|
| THE_GROVE | GROVE_GRASS (dense), FLOWER_BLUE (rare) | OAK |
| JUNGLE | Full variety (grass, ferns, vines, flowers) | JUNGLE |
| PLAINS | GRASS_LOW, GRASS_TALL | OAK |
| DESERT/RED_DESERT | DESERT_SHRUB (sparse) | CACTUS |
| SNOW | SNOW_GRASS | PINE |
| BEACH | Almost none (0.7% SHRUB, 7% GRASS) | PALM (5%) |

### Vegetation Density

`getVegetationDensity()` uses smoothstep blending across climate space:

```
              HUMID
                +
                |
    ICE: 0.05   |  JUNGLE: 0.85
                |
  COLD ---------+--------- HOT
                |
  SNOW: 0.30    |  DESERT: 0.15
                |
                -
              DRY
```

### Issues & Opportunities

| Issue | Severity | Details |
|-------|----------|---------|
| **Vegetation doesn't use erosion/continentalness** | Medium | Coastal forests, cliff-face plants, riparian zones all possible but not implemented. |
| **No seasonal variation** | Low | (Would require time system) Deciduous trees always green. |
| **No elevation-based vegetation zones** | Medium | High altitude should have treeline, then only hardy grasses, then bare rock. |
| **Missing biomes have no distinct flora** | Medium | DESERT, MOUNTAINS never assigned so their flora configs are unused. |
| **Grove and Plains are too similar** | Low | Both use OAK and grass. Grove is supposed to be the "special starting area." |

---

## 6. World Types (Strategy Presets)

### Implemented World Types

```typescript
enum WorldType {
    DEFAULT,      // Normal latitude-based climate
    SKY_ISLANDS,  // Floating archipelago, single biome
    FROZEN,       // Temperature forced to -0.6, low variance
    LUSH,         // Temperature +0.4, humidity boosted
    CHAOS         // 10x noise scale, no latitude
}
```

### Issues & Opportunities

| Issue | Severity | Details |
|-------|----------|---------|
| **WorldType not user-selectable** | Medium | Set via worker CONFIGURE message but no UI to select. |
| **WorldType not persisted** | High | Reloading defaults to DEFAULT even if world was FROZEN. |
| **SKY_ISLANDS overrides biome entirely** | - | Returns 'SKY_ISLANDS' for all positions - intentional single-biome world. |
| **CHAOS could be interesting but untested** | Low | Rapid biome changes (10x frequency) might create visual artifacts at boundaries. |

---

## 7. Missing Features (Compared to Modern Voxel Games)

### Not Implemented

| Feature | Difficulty | Impact |
|---------|------------|--------|
| **Rivers** | High | Requires flow simulation or careful noise carving. Would dramatically improve landscape. |
| **Temperature altitude falloff** | Low | Easy: `temp -= (y - baseHeight) * 0.02`. Creates snow-capped mountains. |
| **Biome sub-variants** | Medium | FOREST_OAK, FOREST_BIRCH, FOREST_MIXED within same climate zone. |
| **Structures** | High | Villages, ruins, dungeons placed in appropriate biomes. |
| **Ore distribution** | Medium | Coal at shallow depths, iron mid, diamonds deep. Biome bonuses. |
| **Rare biomes** | Medium | MUSHROOM_ISLAND (humid + coastal), MESA (hot + very dry + high erosion). |
| **Transition zones** | Medium | Explicit ecotone biomes (FOREST_EDGE, SAVANNA_BORDER) for smoother changes. |

---

## 8. Code Quality Observations

### Strengths

1. **BiomeManager is well-organized** - Single source of truth for climate/biome logic
2. **Worker architecture is sound** - Generation happens off main thread
3. **Physical reality model is forward-thinking** - Continentalness/erosion are underused but correct
4. **Cave settings per-biome** - Shows the pattern for biome-specific features

### Technical Debt

1. **Hardcoded seeds** - Should be configuration
2. **DESERT/MOUNTAINS defined but unreachable** - Dead code or incomplete feature
3. **Vegetation worker duplicates biome lookup** - Could receive biome from terrain pass
4. **No unit tests for biome boundaries** - Edge cases (exactly temp=0.5) untested

---

## 9. Recommended Priority Actions

### Quick Wins (1-2 hours each)

1. **Enable MOUNTAINS biome** via erosion threshold
   ```typescript
   if (erosion > 0.75 && baseBiome !== 'BEACH') return 'MOUNTAINS';
   ```

2. **Enable DESERT biome** (distinguish from RED_DESERT)
   ```typescript
   if (temp > 0.5 && humid < -0.5 && continent > 0.3) return 'DESERT';
   // RED_DESERT for coastal hot deserts
   ```

3. **Add altitude temperature falloff**
   ```typescript
   const altitudePenalty = Math.max(0, (wy - 30) * 0.01);
   const effectiveTemp = temp - altitudePenalty;
   ```

### Medium Effort (4-8 hours each)

4. **Make seed configurable**
   - Add `?seed=12345` URL param
   - Store in WorldDB
   - Propagate to all noise generators

5. **Add fractal octaves to terrain height**
   ```typescript
   let height = 0;
   for (let i = 0; i < 4; i++) {
       height += noise(x * freq, 0, z * freq) * amp;
       freq *= 2.0;
       amp *= 0.5;
   }
   ```

6. **Implement treeline**
   - No trees above Y=60
   - Sparse trees Y=50-60
   - Replace with SNOW_GRASS

### Larger Features (1-2 days each)

7. **River system**
   - Use erosion noise gradient to carve river valleys
   - Fill with water below certain threshold

8. **Biome-specific terrain features**
   - Mesas in deserts (layered terracing)
   - Volcanic islands in ocean (high points with crater)

9. **Structure generation**
   - Define spawn conditions per structure type
   - Use noise to distribute spawn points

---

## 10. Conclusion

The biome system has **strong bones** - the 4-layer climate model, continental/erosion physics, and biome-specific configurations show thoughtful design. However, the implementation is **only using about 60% of its potential**:

- 2 biomes are defined but never generated
- Erosion/continentalness influence height but not biome selection
- Vegetation ignores physical reality layers
- Seeds are hardcoded
- No altitude-based effects

The codebase is well-organized for extension. The recommendations above are ordered by effort/impact ratio. Start with enabling MOUNTAINS and DESERT to immediately expand world variety without new code paths.

---

*Analysis completed: January 2026*
*Files reviewed: 8 core files, ~3000 lines of terrain/biome code*
