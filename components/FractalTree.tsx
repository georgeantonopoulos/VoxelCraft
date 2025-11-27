import * as THREE from 'three';
import React, { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CapsuleCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';

const vertexShader = `
  attribute float aBranchDepth;
  uniform float uGrowthProgress;

  varying float vDepth;

  void main() {
    vDepth = aBranchDepth;

    // Growth Wave
    float start = aBranchDepth * 0.8;
    float end = start + 0.25;
    float scale = smoothstep(start, end, uGrowthProgress);

    // Scale from center
    vec3 transformed = position * scale;

    // Wobble effect
    if (scale < 1.0 && scale > 0.01) {
        float wobble = sin(uGrowthProgress * 15.0 + position.y) * 0.1 * (1.0 - scale);
        transformed.x += wobble;
        transformed.z += wobble;
    }

    csm_Position = transformed;
  }
`;

const fragmentShader = `
  varying float vDepth;

  void main() {
    vec3 wood = vec3(0.2, 0.1, 0.05);
    vec3 glowing = vec3(0.0, 1.0, 1.0); // Cyan

    vec3 col = mix(wood, glowing, pow(vDepth, 4.0));
    csm_DiffuseColor = vec4(col, 1.0);
    csm_Emissive = glowing * step(0.9, vDepth) * 2.0;
  }
`;

interface FractalData {
    matrices: Float32Array;
    depths: Float32Array;
    count: number;
    boundingBox: THREE.Box3;
}

interface ColliderData {
    key: string;
    args: [number, number]; // radius, height
    position: [number, number, number];
    rotation: [number, number, number];
}

export const FractalTree: React.FC<{ position: [number, number, number], seed: number }> = ({ position, seed }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<any>(null);
  const workerRef = useRef<Worker>();

  const [data, setData] = useState<FractalData | null>(null);
  const [colliders, setColliders] = useState<ColliderData[]>([]);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/fractal.worker.ts', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (e) => {
        const { matrices, depths, boundingBox, count } = e.data;
        const box = new THREE.Box3(
            new THREE.Box3().fromArray(boundingBox.min),
            new THREE.Box3().fromArray(boundingBox.max)
        );
        setData({ matrices, depths, count, boundingBox: box });
    };

    workerRef.current.postMessage({ seed, iterations: 6, position });

    return () => workerRef.current?.terminate();
  }, [seed, position]);

  useEffect(() => {
    if (!meshRef.current || !data) return;

    for (let i = 0; i < data.count; i++) {
        const mat = new THREE.Matrix4().fromArray(data.matrices, i * 16);
        meshRef.current.setMatrixAt(i, mat);
    }

    meshRef.current.geometry.setAttribute('aBranchDepth', new THREE.InstancedBufferAttribute(data.depths, 1));
    meshRef.current.geometry.boundingBox = data.boundingBox;
    meshRef.current.geometry.boundingSphere = new THREE.Sphere();
    data.boundingBox.getBoundingSphere(meshRef.current.geometry.boundingSphere);

    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [data]);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      // 5 second growth
      const t = Math.min(clock.getElapsedTime() * 0.2, 1.0);
      materialRef.current.uniforms.uGrowthProgress.value = t;

      if (t >= 1.0 && !grown && data) {
          generateColliders(data);
          setGrown(true);
      }
    }
  });

  const generateColliders = (fractal: FractalData) => {
      const cols: ColliderData[] = [];
      const _mat = new THREE.Matrix4();
      const _pos = new THREE.Vector3();
      const _quat = new THREE.Quaternion();
      const _scale = new THREE.Vector3();
      const _euler = new THREE.Euler();

      // Only colliderize trunk and thick branches
      for(let i=0; i<fractal.count; i++) {
          if (fractal.depths[i] < 0.3) {
              _mat.fromArray(fractal.matrices, i*16);
              _mat.decompose(_pos, _quat, _scale);
              _euler.setFromQuaternion(_quat);

              // Apply world offset since instances are local 0,0,0 based in the worker logic relative to stack
              // Actually worker logic returns positions relative to 0,0,0 of the tree root.
              // So we add 'position' prop.

              cols.push({
                  key: `col-${i}`,
                  args: [_scale.x/2, _scale.y], // radius, height
                  position: [_pos.x + position[0], _pos.y + position[1], _pos.z + position[2]],
                  rotation: [_euler.x, _euler.y, _euler.z]
              });
          }
      }
      setColliders(cols);
  };

  if (!data) return null;

  return (
    <group position={position}>
        <instancedMesh ref={meshRef} args={[undefined, undefined, data.count]} frustumCulled={false}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
            <CustomShaderMaterial
                ref={materialRef}
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={{ uGrowthProgress: { value: 0 } }}
                toneMapped={false}
                transparent
            />
        </instancedMesh>

        {grown && (
            <RigidBody type="fixed" colliders={false}>
                {colliders.map(c => (
                    <CapsuleCollider key={c.key} args={c.args} position={c.position} rotation={c.rotation} />
                ))}
            </RigidBody>
        )}
    </group>
  );
};