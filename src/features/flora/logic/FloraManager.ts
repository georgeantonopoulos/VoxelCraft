import * as THREE from 'three';

export class FloraManager {
  private static instance: FloraManager;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private dummy = new THREE.Object3D();
  private scene: THREE.Scene | null = null;
  private ids: string[] = [];

  // Use a simpler geometry than the full LuminaFlora for now, or just spheres.
  // The plan specified "Collectibles".
  // Let's use a SphereGeometry and the same Shader material if possible, or a simple MeshStandardMaterial.
  // We'll init with capacity for 1000 items.
  private MAX_INSTANCES = 1000;

  private constructor() {}

  static getInstance(): FloraManager {
    if (!FloraManager.instance) {
      FloraManager.instance = new FloraManager();
    }
    return FloraManager.instance;
  }

  init(scene: THREE.Scene) {
    if (this.instancedMesh) return; // Already init
    this.scene = scene;

    const geometry = new THREE.SphereGeometry(0.25, 16, 16);
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#222'),
        emissive: new THREE.Color('#00FFFF'),
        emissiveIntensity: 1.5,
        toneMapped: false
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.MAX_INSTANCES);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.count = 0;

    // Add to scene - Use a specific group or just add to scene
    // But FloraPlacer was managing "User Placed" entities.
    // We should probably just manage the mesh itself and let React handle the lifecycle of the Manager via useEffect?
    // No, the directive is "Vanilla JS Class".
    scene.add(this.instancedMesh);
  }

  updateFlora(entities: Map<string, any>) {
    if (!this.instancedMesh) return;

    let count = 0;
    const floras = Array.from(entities.values()).filter(e => e.type === 'FLORA');

    // Rebuild mesh if needed?
    // If we want to avoid re-rendering, we should only update changes.
    // But since this is called from FloraPlacer which subscribes to store, we receive the full list.
    // For "Stop React from re-rendering", FloraPlacer should NOT subscribe to the store for RENDER.
    // It should subscribe in a useEffect and call this manager.

    floras.forEach((flora, i) => {
        if (i >= this.MAX_INSTANCES) return;

        this.dummy.position.set(flora.position.x, flora.position.y, flora.position.z);
        this.dummy.updateMatrix();
        this.instancedMesh!.setMatrixAt(i, this.dummy.matrix);
        count++;
    });

    this.instancedMesh.count = count;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.instancedMesh && this.scene) {
        this.scene.remove(this.instancedMesh);
        this.instancedMesh.geometry.dispose();
        (this.instancedMesh.material as THREE.Material).dispose();
        this.instancedMesh = null;
    }
  }
}
