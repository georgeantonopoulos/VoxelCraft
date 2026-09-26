import type { RapierRigidBody } from '@react-three/rapier';

/** Live physics bodies of dropped/thrown items by item id (PhysicsItem registers them), for saving where they lie. */
export const physicsItemBodies = new Map<string, RapierRigidBody>();
