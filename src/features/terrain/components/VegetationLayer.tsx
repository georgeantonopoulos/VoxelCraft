import React, { useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { VEGETATION_ASSETS } from '../logic/VegetationConfig';

// The "Life" Shader: Wind sway and subtle color variation
const VEGETATION_SHADER = {
  // inside VEGETATION_SHADER object
  vertex: `
  uniform float uTime;
  uniform float uSway;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Get world position from instance matrix
    // instanceMatrix is a mat4 attribute available in InstancedMesh vertex shader
    vec4 worldInstancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float worldX = worldInstancePos.x;
    float worldZ = worldInstancePos.z;

    // --- Wind Simulation ---
    // Simple sway based on time and position
    // We use the world position to offset the phase so they don't all sway in unison
    float wind = sin(uTime * 2.0 + worldX * 0.5 + worldZ * 0.3) + sin(uTime * 1.0 + worldX * 0.2);
    
    // Apply sway primarily to the top of the vegetation (uv.y is 0 at bottom, 1 at top)
    // uSway controls the magnitude from config
    float swayStrength = uSway * pow(uv.y, 2.0) * 0.15; 
    
    pos.x += wind * swayStrength;
    pos.z += wind * swayStrength * 0.5;

    // --- THE FIX: Normal Hack ---
    // We blend the actual normal with a straight-up vector.
    // 0.0 = Realism (Jagged), 1.0 = Cartoon Softness (fluffy)
    vec3 originalNormal = normal;
    vec3 upNormal = vec3(0.0, 1.0, 0.0);
    
    // Mix based on how 'fluffy' you want it. 0.6 is a sweet spot.
    vec3 newNormal = normalize(mix(originalNormal, upNormal, 0.6));
    
    // Pass this to the built-in Three.js material handling
    csm_Normal = newNormal; 
    
    csm_Position = pos;
    vWorldPos = vec3(worldX, worldInstancePos.y, worldZ);
  }
`,
  fragment: `
    varying vec3 vWorldPos;
    varying vec2 vUv;
    
    void main() {
       // Lush Gradient: Darker at bottom (roots), lighter at top (tips)
       // Mix from a dark root color (multiply) to normal color
       float gradient = smoothstep(0.0, 1.0, vUv.y);
       
       // Add subtle variation to color based on position to break uniformity
       float noise = sin(vWorldPos.x * 0.5) * cos(vWorldPos.z * 0.5);
       
       vec3 col = csm_DiffuseColor.rgb;
       
       // Apply noise variation
       col += noise * 0.05;
       
       // Apply lush gradient (dark roots)
       vec3 rootCol = col * 0.4;
       col = mix(rootCol, col * 1.1, gradient); // Tips slightly brighter

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
    // Generates 3-5 blades radiating from center with curvature
    // 1. Grass Clump (Blade clusters)
    // Generates 3-5 blades radiating from center with curvature
    const createGrassGeo = (bladeCount: number, height: number, width: number) => {
      const positions: number[] = [];
      const indices: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];

      let idx = 0;
      const SEGMENTS = 2; // Reduced segments for cleaner look

      for (let i = 0; i < bladeCount; i++) {
        const angle = (i / bladeCount) * Math.PI * 2 + (Math.random() * 0.5);
        const lean = (Math.random() * 0.3) + 0.1; // Reduced lean (was 0.5 + 0.2)
        const curve = (Math.random() * 0.2) + 0.05; // Reduced curve (was 0.3 + 0.1)

        // Blade properties - Wider base
        const w = width * (1.2 + Math.random() * 0.5); // Wider (was 0.8)
        const h = height * (0.8 + Math.random() * 0.4);

        // Base center
        const bx = 0;
        const bz = 0;

        // Generate segments
        for (let j = 0; j <= SEGMENTS; j++) {
          const t = j / SEGMENTS; // 0 to 1

          // Width tapers to point
          const currentW = w * (1.0 - t);

          // Height grows linearly
          const y = h * t;

          // X/Z offset (Lean + Curve)
          // Curve is quadratic (t^2)
          const offset = (lean * t) + (curve * t * t);

          const cx = bx + Math.sin(angle) * offset;
          const cz = bz + Math.cos(angle) * offset;

          // Left and Right vertices at this height
          // Perpendicular to angle
          const px = Math.cos(angle) * currentW * 0.5;
          const pz = -Math.sin(angle) * currentW * 0.5;

          // Vertex 1 (Left)
          positions.push(cx + px, y, cz + pz);
          // Vertex 2 (Right)
          positions.push(cx - px, y, cz - pz);

          // Normals (approximate up/out)
          // Tilted slightly out
          const ny = 1.0;
          const nx = Math.sin(angle) * 0.5;
          const nz = Math.cos(angle) * 0.5;
          // Normalize roughly
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

          normals.push(nx / len, ny / len, nz / len);
          normals.push(nx / len, ny / len, nz / len);

          uvs.push(0, t);
          uvs.push(1, t);
        }

        // Indices for quads between segments
        for (let j = 0; j < SEGMENTS; j++) {
          const base = idx + j * 2;
          // Quad: base, base+1, base+3, base+2
          indices.push(
            base, base + 1, base + 2,
            base + 2, base + 1, base + 3,
            // Back face
            base + 1, base, base + 2,
            base + 1, base + 2, base + 3
          );
        }

        idx += (SEGMENTS + 1) * 2;
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
        case 6: geoName = 'grass_low'; break; // Jungle grass
        case 7: geoName = 'grass_low'; break; // Grove grass
      }

      return {
        id: typeId,
        asset,
        positions, // Float32Array
        count: positions.length / 6, // Stride is now 6 (x, y, z, nx, ny, nz)
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
              uSway: { value: batch!.asset.sway },
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

    const count = positions.length / 6; // Stride 6
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const qY = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      const idx = i * 6;
      dummy.position.set(positions[idx], positions[idx + 1], positions[idx + 2]);

      // Read Normal
      normal.set(positions[idx + 3], positions[idx + 4], positions[idx + 5]);

      // Align to normal
      q.setFromUnitVectors(up, normal);

      // Random rotation around Y (local up)
      qY.setFromAxisAngle(up, Math.random() * Math.PI * 2);

      // Combine: Align to normal, then rotate around local up
      // Note: q * qY means apply qY first (local rotation), then q (alignment)
      dummy.quaternion.copy(q).multiply(qY);

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
