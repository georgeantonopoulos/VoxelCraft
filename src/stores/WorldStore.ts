import { create } from 'zustand';
import { Vector3 } from 'three';
import React from 'react';
import { getChunkKeyFromPos, getNeighborKeys } from '../utils/spatial';

export type EntityType = 'FLORA' | 'TREE_STUMP' | 'BEE';

export interface EntityData {
  id: string;
  type: EntityType;
  position: Vector3;
  // Storing the ref here allows systems to access physics bodies
  // without needing to pass props down through React.
  bodyRef?: React.RefObject<any>;
}

interface WorldState {
  // The "Database": Instant lookup by ID
  entities: Map<string, EntityData>;

  // The "Spatial Index": Instant lookup by Location
  // Key: "1:0:-2" (Chunk ID) -> Value: Set of Entity IDs
  spatialMap: Map<string, Set<string>>;

  addEntity: (data: EntityData) => void;
  removeEntity: (id: string) => void;

  // Optimized Query: Returns entities only in the relevant chunks
  getEntitiesNearby: (pos: Vector3, searchRadius?: number) => EntityData[];
}

export const useWorldStore = create<WorldState>((set, get) => ({
  entities: new Map(),
  spatialMap: new Map(),

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
  }
}));
