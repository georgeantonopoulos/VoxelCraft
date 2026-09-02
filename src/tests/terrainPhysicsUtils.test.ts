import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { getSafeShardSpawnPosition } from '@features/terrain/logic/terrainPhysicsUtils';

beforeAll(async () => {
  await RAPIER.init({});
});

describe('terrain physics utilities', () => {
  it('lifts shards above the terrain collider surface', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    body.userData = { type: 'terrain' };
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(1, 1, new Float32Array(4), { x: 2, y: 1, z: 2 }),
      body
    );
    world.step();

    const spawnPosition = getSafeShardSpawnPosition(world, RAPIER.Ray, { x: 0, y: -0.4, z: 0 });
    expect(spawnPosition[0]).toBe(0);
    expect(spawnPosition[1]).toBeCloseTo(0.3);
    expect(spawnPosition[2]).toBe(0);

    const shard = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(...spawnPosition).setCcdEnabled(true)
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.08, 0.08, 0.08), shard);
    for (let i = 0; i < 180; i++) world.step();
    expect(shard.translation().y).toBeGreaterThan(0.07);

    world.free();
  });

  it('keeps the normal lift when no terrain is nearby', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    expect(getSafeShardSpawnPosition(world, RAPIER.Ray, { x: 2, y: 4, z: 3 }))
      .toEqual([2, 4.5, 3]);

    world.free();
  });
});
