import type { RapierRigidBody } from '@react-three/rapier';

/**
 * Live physics bodies of dropped/thrown items by item id, for saving where
 * they lie. Stores a getter, not a body: planting a stick (or anchoring a
 * stone) remounts its RigidBody, and calling translation() on the removed
 * body panicked inside Rapier, poisoning the physics world (the game froze
 * after placing a second stick). The getter always reads the mounted body.
 */
export const physicsItemBodies = new Map<string, () => RapierRigidBody | null>();
