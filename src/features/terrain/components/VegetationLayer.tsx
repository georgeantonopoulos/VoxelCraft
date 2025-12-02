import React, { useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { VEGETATION_ASSETS } from '../logic/VegetationConfig';

// The "Life" Shader: Wind sway and subtle color variation
const VEGETATION_SHADER = {
  vertex: `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // Wind Simulation
      // Sway based on height (pos.y), Time, and World Position (for wave effect)
      float windFreq = 1.5;
      float windAmp = 0.1 * pos.y * pos.y; // Curve: stiff at bottom, loose at top

      // Instance matrix contains the world position offset in [3][0], [3][2]
      float worldX = instanceMatrix[3][0];
      float worldZ = instanceMatrix[3][2];

      float swayX = sin(uTime * windFreq + worldX * 0.5) * windAmp;
      float swayZ = cos(uTime * (windFreq * 0.8) + worldZ * 0.5) * windAmp;

      pos.x += swayX;
      pos.z += swayZ;

      csm_Position = pos;
      vWorldPos = vec3(worldX, 0.0, worldZ);
    }
  `,
  fragment: `
    varying vec3 vWorldPos;
    varying vec2 vUv;
    
    void main() {
       // Gradient from bottom to top (fake AO)
       float gradient = smoothstep(0.0, 1.0, vUv.y * 1.5 + 0.2);
       
       // Add subtle variation to color based on position to break uniformity
       float noise = sin(vWorldPos.x * 0.1) * cos(vWorldPos.z * 0.1) * 0.1;
       
       vec3 col = csm_DiffuseColor.rgb;
       col += noise * 0.1;
       col *= gradient;

       csm_DiffuseColor = vec4(col, 1.0);
    }
  `
};

interface VegetationLayerProps {
  data: Record<string, Float32Array>; // vegetationData from worker
}

export const VegetationLayer: React.FC<VegetationLayerProps> = React.memo(({ data }) => {
  const materials = useRef<THREE.ShaderMaterial[]>([]);

  // Update time uniform every frame
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    materials.current.forEach(mat => {
      if (mat && mat.uniforms?.uTime) mat.uniforms.uTime.value = t;
    });
  });

  // Construct standard geometries once
  const geometries = useMemo(() => {
    const geoMap = new Map();

    // --- GEOMETRY GENERATORS ---

    // 1. Grass Clump (Blade clusters)
    // Generates 3-5 blades radiating from center
    const createGrassGeo = (bladeCount: number, height: number, width: number) => {
      const positions: number[] = [];
      const indices: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];

      let idx = 0;
      for (let i = 0; i < bladeCount; i++) {
        const angle = (i / bladeCount) * Math.PI * 2 + (Math.random() * 0.5);
        const lean = (Math.random() * 0.3) + 0.1; // Lean out

        // Blade is a simple triangle or quad. Let's do a tapered quad (trapezoid)
        // Base width
        const w = width * (0.8 + Math.random() * 0.4);
        const h = height * (0.8 + Math.random() * 0.4);

        // Base center
        const bx = 0;
        const bz = 0;

        // Top position (leaned out)
        const tx = Math.sin(angle) * lean * h;
        const tz = Math.cos(angle) * lean * h;
        const ty = h;

        // Vertices
        // BL
        const x0 = bx + Math.cos(angle) * w * 0.5;
        const z0 = bz - Math.sin(angle) * w * 0.5;
        // BR
        const x1 = bx - Math.cos(angle) * w * 0.5;
        const z1 = bz + Math.sin(angle) * w * 0.5;
        // TL (tapered)
        const x2 = tx + Math.cos(angle) * w * 0.1;
        const z2 = tz - Math.sin(angle) * w * 0.1;
        // TR
        const x3 = tx - Math.cos(angle) * w * 0.1;
        const z3 = tz + Math.sin(angle) * w * 0.1;

        positions.push(
          x0, 0, z0, // 0
          x1, 0, z1, // 1
          x2, ty, z2, // 2
          x3, ty, z3  // 3
        );

        // Normals (approximate up/out)
        // For stylized grass, pointing UP is usually best for lighting
        normals.push(
          0, 1, 0,
          0, 1, 0,
          0, 1, 0,
          0, 1, 0
        );

        uvs.push(
          0, 0,
          1, 0,
          0, 1,
          1, 1
        );

        // Double sided indices
        indices.push(
          idx, idx + 1, idx + 2,
          idx + 2, idx + 1, idx + 3,
          idx + 1, idx, idx + 2, // Back face
          idx + 1, idx + 2, idx + 3
        );

        idx += 4;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
      geo.setIndex(indices);
      return geo;
    };

    // 2. Flower (Stem + Head)
    const createFlowerGeo = () => {
      // Stem (thin box) - Half height/width
      const stemHeight = 0.35;
      const stemGeo = new THREE.BoxGeometry(0.025, stemHeight, 0.025);
      stemGeo.translate(0, stemHeight / 2, 0);

      // Flower Head (Cone or Box)
      const headGeo = new THREE.CylinderGeometry(0.1, 0.0, 0.1, 5);
      headGeo.translate(0, stemHeight + 0.05, 0);
      headGeo.rotateX(Math.PI * 0.1); // Tilt slightly

      const pos: number[] = [];
      const ind: number[] = [];
      const norm: number[] = [];

      // Helper to add box
      const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        const p = g.attributes.position.array;
        const n = g.attributes.normal.array;
        const i = g.index!.array;
        const offset = pos.length / 3;

        for (let k = 0; k < p.length; k++) pos.push(p[k]);
        for (let k = 0; k < n.length; k++) norm.push(n[k]);
        for (let k = 0; k < i.length; k++) ind.push(i[k] + offset);
      };

      addBox(0.02, 0.3, 0.02, 0, 0.15, 0); // Stem
      addBox(0.1, 0.1, 0.1, 0, 0.35, 0);   // Head

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norm), 3));
      geo.setIndex(ind);
      return geo;
    };

    // 3. Fern (Curved Fronds)
    const createFernGeo = () => {
      // Similar to grass but wider, more curved, and more horizontal
      // We can reuse grass logic with different params
      // 5 blades, shorter, wider, more lean
      return createGrassGeo(6, 0.25, 0.2);
    };

    // 4. Shrub (Cluster of boxes)
    const createShrubGeo = () => {
      const pos: number[] = [];
      const ind: number[] = [];
      const norm: number[] = [];

      const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        const p = g.attributes.position.array;
        const n = g.attributes.normal.array;
        const i = g.index!.array;
        const offset = pos.length / 3;
        for (let k = 0; k < p.length; k++) pos.push(p[k]);
        for (let k = 0; k < n.length; k++) norm.push(n[k]);
        for (let k = 0; k < i.length; k++) ind.push(i[k] + offset);
      };

      // Main bush - Half size
      addBox(0.25, 0.25, 0.25, 0, 0.125, 0);
      // Random smaller boxes
      addBox(0.15, 0.15, 0.15, 0.15, 0.15, 0);
      addBox(0.15, 0.15, 0.15, -0.1, 0.2, 0.1);
      addBox(0.15, 0.15, 0.15, 0, 0.15, -0.15);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norm), 3));
      geo.setIndex(ind);
      return geo;
    };


    // Assign Geometries
    // Half size and thinner as requested
    geoMap.set('grass_low', createGrassGeo(3, 0.3, 0.08));
    geoMap.set('grass_tall', createGrassGeo(4, 0.6, 0.1));
    geoMap.set('flower', createFlowerGeo()); // Updated internally below
    geoMap.set('fern', createFernGeo());
    geoMap.set('shrub', createShrubGeo());

    // Fallback
    geoMap.set('box', new THREE.BoxGeometry(0.2, 0.5, 0.2));

    return geoMap;
  }, []);

  // Process batches
  const batches = useMemo(() => {
    if (!data) return [];
    return Object.entries(data).map(([typeStr, positions]) => {
      const typeId = parseInt(typeStr);
      const asset = VEGETATION_ASSETS[typeId];
      if (!asset) return null;

      let geoName = 'box';
      // Map config types to our new geo generators
      // Note: VegetationConfig types are numbers, we map them here manually or via config
      // For now, hardcode mapping based on known types:
      // GRASS_LOW=0, GRASS_TALL=1, FLOWER_BLUE=2, DESERT_SHRUB=3, SNOW_GRASS=4, JUNGLE_FERN=5
      switch (typeId) {
        case 0: geoName = 'grass_low'; break;
        case 1: geoName = 'grass_tall'; break;
        case 2: geoName = 'flower'; break;
        case 3: geoName = 'shrub'; break;
        case 4: geoName = 'grass_low'; break; // Snow grass uses low grass geo
        case 5: geoName = 'fern'; break;
      }

      return {
        id: typeId,
        asset,
        positions, // Float32Array
        count: positions.length / 3,
        geometry: geometries.get(geoName) || geometries.get('box')
      };
    }).filter(Boolean);
  }, [data, geometries]);

  return (
    <group>
      {batches.map((batch, i) => (
        <instancedMesh
          key={batch!.id}
          args={[batch!.geometry, undefined, batch!.count]}
          castShadow
          receiveShadow
        >
          <CustomShaderMaterial
            ref={(ref: any) => (materials.current[i] = ref)}
            baseMaterial={THREE.MeshStandardMaterial}
            vertexShader={VEGETATION_SHADER.vertex}
            fragmentShader={VEGETATION_SHADER.fragment}
            uniforms={{
              uTime: { value: 0 },
            }}
            color={batch!.asset.color}
            roughness={0.8}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
          <InstanceMatrixSetter positions={batch!.positions} scale={batch!.asset.scale} />
        </instancedMesh>
      ))}
    </group>
  );
});

// Helper component to set matrices layout-effect style
const InstanceMatrixSetter = ({ positions, scale }: { positions: Float32Array, scale: number[] }) => {
  const anchorRef = useRef<THREE.Object3D>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const anchorObject = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const parent = anchorRef.current?.parent as THREE.InstancedMesh | undefined;
    if (!parent) return;

    const count = positions.length / 3;
    for (let i = 0; i < count; i++) {
      dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      const s = Math.random() * 0.3 + 0.85; // Slight size variance
      dummy.scale.set(scale[0] * s, scale[1] * s, scale[2] * s);
      dummy.updateMatrix();
      parent.setMatrixAt(i, dummy.matrix);
    }
    parent.instanceMatrix.needsUpdate = true;
  }, [positions, scale, dummy]);

  // Attach a tiny helper object so we can grab the InstancedMesh parent reliably
  return <primitive ref={anchorRef} object={anchorObject} />;
};
