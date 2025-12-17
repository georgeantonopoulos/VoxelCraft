import { create } from 'zustand';
import { Quaternion, Vector3 } from 'three';
import React from 'react';
import { getChunkKeyFromPos, getNeighborKeys } from '@utils/spatial';

export interface FloraHotspot {
  x: number;
  z: number;
}

export interface GroundHotspot {
  x: number;
  z: number;
}

export type EntityType = 'FLORA' | 'TORCH' | 'TREE_STUMP' | 'BEE';

export interface EntityData {
  id: string;
  type: EntityType;
  position: Vector3;
  // Optional orientation for entities that need to "stick" to geometry (e.g. wall torches).
  // We store a quaternion to avoid recomputing on every render.
  rotation?: Quaternion;
  // Storing the ref here allows systems to access physics bodies
  // without needing to pass props down through React.
  bodyRef?: React.RefObject<any>;
}

export interface PlayerParams {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

interface WorldState {
  // Player Position & Rotation
  playerParams: PlayerParams;
  setPlayerParams: (params: PlayerParams) => void;

  // The "Database": Instant lookup by ID
  entities: Map<string, EntityData>;

  // The "Spatial Index": Instant lookup by Location
  // Key: "1:0:-2" (Chunk ID) -> Value: Set of Entity IDs
  spatialMap: Map<string, Set<string>>;

  // Hotspots for naturally generated flora (per chunk key)
  floraHotspots: Map<string, FloraHotspot[]>;

  // Hotspots for naturally generated ground pickups (per chunk key)
  stickHotspots: Map<string, GroundHotspot[]>;
  rockHotspots: Map<string, GroundHotspot[]>;

  addEntity: (data: EntityData) => void;
  addEntities: (data: EntityData[]) => void;
  removeEntity: (id: string) => void;
  removeEntitiesInChunk: (chunkKey: string) => void;

  // Optimized Query: Returns entities only in the relevant chunks
  getEntitiesNearby: (pos: Vector3, searchRadius?: number) => EntityData[];

  /**
   * Store or replace flora hotspot positions for a chunk.
   */
  setFloraHotspots: (chunkKey: string, hotspots: FloraHotspot[]) => void;

  /**
   * Clear hotspot data when a chunk unloads.
   */
  clearFloraHotspots: (chunkKey: string) => void;

  /**
   * Retrieve flora hotspots within a radius (for UI overlays).
   */
  getFloraHotspotsNearby: (pos: Vector3, searchRadius?: number) => FloraHotspot[];

  setStickHotspots: (chunkKey: string, hotspots: GroundHotspot[]) => void;
  clearStickHotspots: (chunkKey: string) => void;
  getStickHotspotsNearby: (pos: Vector3, searchRadius?: number) => GroundHotspot[];

  setRockHotspots: (chunkKey: string, hotspots: GroundHotspot[]) => void;
  clearRockHotspots: (chunkKey: string) => void;
  getRockHotspotsNearby: (pos: Vector3, searchRadius?: number) => GroundHotspot[];
}

export const useWorldStore = create<WorldState>((set, get) => ({
  playerParams: { x: 0, y: 0, z: 0, rotation: 0 },
  setPlayerParams: (params) => set({ playerParams: params }),

  entities: new Map(),
  spatialMap: new Map(),
  floraHotspots: new Map(),
  stickHotspots: new Map(),
  rockHotspots: new Map(),

  addEntity: (data) => set((state) => {
    // 1. Add to main database
    const newEntities = new Map(state.entities);
    newEntities.set(data.id, data);

    // 2. Add to spatial index
    const key = getChunkKeyFromPos(data.position);
    const newSpatial = new Map(state.spatialMap);

    if (!newSpatial.has(key)) {
      newSpatial.set(key, new Set());
    }
    newSpatial.get(key)!.add(data.id);

    return { entities: newEntities, spatialMap: newSpatial };
  }),

  addEntities: (dataList) => set((state) => {
    if (dataList.length === 0) return state;

    const newEntities = new Map(state.entities);
    const newSpatial = new Map(state.spatialMap);

    for (const data of dataList) {
      newEntities.set(data.id, data);
      const key = getChunkKeyFromPos(data.position);

      if (!newSpatial.has(key)) {
        newSpatial.set(key, new Set());
      }
      newSpatial.get(key)!.add(data.id);
    }

    return { entities: newEntities, spatialMap: newSpatial };
  }),

  removeEntity: (id) => set((state) => {
    const entity = state.entities.get(id);
    if (!entity) return state;

    const newEntities = new Map(state.entities);
    newEntities.delete(id);

    // Remove from spatial index
    const key = getChunkKeyFromPos(entity.position);
    const newSpatial = new Map(state.spatialMap);

    if (newSpatial.has(key)) {
      newSpatial.get(key)!.delete(id);
      // Clean up empty buckets to save memory
      if (newSpatial.get(key)!.size === 0) {
        newSpatial.delete(key);
      }
    }

    return { entities: newEntities, spatialMap: newSpatial };
  }),

  removeEntitiesInChunk: (chunkKey) => set((state) => {
    const ids = state.spatialMap.get(chunkKey);
    if (!ids) return state;

    const newEntities = new Map(state.entities);
    const newSpatial = new Map(state.spatialMap);

    // Remove all entities in this chunk from the main map
    for (const id of ids) {
      newEntities.delete(id);
    }

    // Remove the chunk entry from the spatial map
    newSpatial.delete(chunkKey);

    return { entities: newEntities, spatialMap: newSpatial };
  }),

  getEntitiesNearby: (pos, searchRadius = 16) => {
    const { entities, spatialMap } = get();
    const centerKey = getChunkKeyFromPos(pos);
    // We check the chunk we are in, plus neighbors, to ensure we don't miss
    // items right across the boundary line.
    const neighbors = getNeighborKeys(centerKey);

    const result: EntityData[] = [];
    const radiusSq = searchRadius * searchRadius;

    for (const key of neighbors) {
      const ids = spatialMap.get(key);
      if (!ids) continue;

      for (const id of ids) {
        const ent = entities.get(id);
        // Precise distance check within the rough buckets
        if (ent && ent.position.distanceToSquared(pos) < radiusSq) {
          result.push(ent);
        }
      }
    }
    return result;
  },

  setFloraHotspots: (chunkKey, hotspots) => set((state) => {
    const next = new Map(state.floraHotspots);
    next.set(chunkKey, hotspots);
    return { floraHotspots: next };
  }),

  clearFloraHotspots: (chunkKey) => set((state) => {
    if (!state.floraHotspots.has(chunkKey)) return state;
    const next = new Map(state.floraHotspots);
    next.delete(chunkKey);
    return { floraHotspots: next };
  }),

  getFloraHotspotsNearby: (pos, searchRadius = 160) => {
    const { floraHotspots } = get();
    const results: FloraHotspot[] = [];
    const radiusSq = searchRadius * searchRadius;

    floraHotspots.forEach((spots) => {
      for (const spot of spots) {
        const dx = spot.x - pos.x;
        const dz = spot.z - pos.z;
        if (dx * dx + dz * dz <= radiusSq) {
          results.push(spot);
        }
      }
    });

    return results;
  },

  setStickHotspots: (chunkKey, hotspots) => set((state) => {
    const next = new Map(state.stickHotspots);
    next.set(chunkKey, hotspots);
    return { stickHotspots: next };
  }),

  clearStickHotspots: (chunkKey) => set((state) => {
    if (!state.stickHotspots.has(chunkKey)) return state;
    const next = new Map(state.stickHotspots);
    next.delete(chunkKey);
    return { stickHotspots: next };
  }),

  getStickHotspotsNearby: (pos, searchRadius = 160) => {
    const { stickHotspots } = get();
    const results: GroundHotspot[] = [];
    const radiusSq = searchRadius * searchRadius;

    stickHotspots.forEach((spots) => {
      for (const spot of spots) {
        const dx = spot.x - pos.x;
        const dz = spot.z - pos.z;
        if (dx * dx + dz * dz <= radiusSq) {
          results.push(spot);
        }
      }
    });

    return results;
  },

  setRockHotspots: (chunkKey, hotspots) => set((state) => {
    const next = new Map(state.rockHotspots);
    next.set(chunkKey, hotspots);
    return { rockHotspots: next };
  }),

  clearRockHotspots: (chunkKey) => set((state) => {
    if (!state.rockHotspots.has(chunkKey)) return state;
    const next = new Map(state.rockHotspots);
    next.delete(chunkKey);
    return { rockHotspots: next };
  }),

  getRockHotspotsNearby: (pos, searchRadius = 160) => {
    const { rockHotspots } = get();
    const results: GroundHotspot[] = [];
    const radiusSq = searchRadius * searchRadius;

    rockHotspots.forEach((spots) => {
      for (const spot of spots) {
        const dx = spot.x - pos.x;
        const dz = spot.z - pos.z;
        if (dx * dx + dz * dz <= radiusSq) {
          results.push(spot);
        }
      }
    });

    return results;
  }
}));
