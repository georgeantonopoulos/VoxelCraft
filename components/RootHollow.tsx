import React, { useState, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';
import { useGameStore } from '../services/GameManager';
import { FractalTree } from './FractalTree';
import { getNoiseTexture } from '../utils/sharedResources';

// AAA Visual Config - Matching the reference image
const STUMP_CONFIG = {
    woodColor: new THREE.Color('#4a4238'), // Weathered grey-brown wood
    barkColor: new THREE.Color('#2b2622'), // Dark crevices
    mossColor: new THREE.Color('#6a8a35'), // Vibrant moss
    height: 1.4,
    scale: 1.0
};

const stumpVertex = `
  uniform float uTime;
  uniform sampler3D uNoise;
  
  varying vec3 vStumpWorldPos;
  varying vec3 vStumpNormal;
  varying vec2 vStumpUv;
  varying float vDisplacement;
  varying float vStumpHeight; // Add height varying for fragment shader usage

  // --- NOISE FUNCTIONS ---
  
  // 3D Value Noise
  float noise3D(vec3 p) {
      return texture(uNoise, p * 0.5).r;
  }

  // FBM for Bark Detail
  float fbm(vec3 p) {
      float value = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 3; i++) {
          value += texture(uNoise, p).r * amp;
          p *= 2.2;
          amp *= 0.5;
      }
      return value;
  }

  // --- DISPLACEMENT FUNCTION ---
  // Calculates the displaced position for a given point.
  // We extract this to a function so we can call it multiple times for normal calculation.
  vec3 getDisplacedPosition(vec3 pos) {
      float angle = atan(pos.x, pos.z);
      float dist = length(vec3(pos.x, 0.0, pos.z));
      float h = pos.y; // Height relative to base
      
      // 1. ROOT FLARES (The main shape)
      // 5-sided star shape for roots
      float roots = sin(angle * 5.0 + sin(pos.y * 2.0)) * 0.5 + 0.5; 
      // Sharpen the roots to make them finger-like
      roots = smoothstep(0.2, 0.8, roots); 
      
      // Flare intensity increases at the bottom
      float flare = 1.0 - smoothstep(0.0, 1.2, h);
      flare = pow(flare, 2.5) * 3.5; // Strong flare at bottom
      
      // Direction outward
      vec3 dir = normalize(vec3(pos.x, 0.0, pos.z));
      if (length(vec3(pos.x, 0.0, pos.z)) < 0.001) dir = vec3(1.0, 0.0, 0.0);

      vec3 newPos = pos + dir * roots * flare * 0.4;

      // 2. BARK DETAIL (High frequency)
      float bark = fbm(pos * 1.5 + vec3(0.0, uTime * 0.02, 0.0));
      float ridge = 1.0 - abs(bark * 2.0 - 1.0);
      ridge = pow(ridge, 4.0); // Sharp ridges
      
      // Push ridges out along normal (approximate normal is 'dir')
      newPos += dir * ridge * 0.15;

      // 3. TOP RIM IRREGULARITY
      if (h > 1.0) {
          float jagged = noise3D(pos * 2.0);
          newPos.y -= jagged * 0.5;
          newPos.x += (jagged - 0.5) * 0.3;
          newPos.z += (jagged - 0.5) * 0.3;
      }
      
      return newPos;
  }

  void main() {
    vStumpUv = uv;
    
    // 1. Calculate Displaced Position
    vec3 pos = position;
    vec3 displacedPos = getDisplacedPosition(pos);
    
    // 2. RECOMPUTE NORMAL (Finite Difference)
    // This is critical for correct lighting on the displaced mesh.
    // We sample the displacement function at tiny offsets.
    float epsilon = 0.01;
    vec3 pX = getDisplacedPosition(pos + vec3(epsilon, 0.0, 0.0));
    vec3 pZ = getDisplacedPosition(pos + vec3(0.0, 0.0, epsilon));
    
    vec3 tangentX = normalize(pX - displacedPos);
    vec3 tangentZ = normalize(pZ - displacedPos);
    
    // Reconstruct normal: cross product of tangents
    // For a cylinder, Y is up, so we cross Z and X roughly? 
    // Actually, let's use the surface tangents.
    vec3 newNormal;
    vec3 calculatedNormal = cross(tangentZ, tangentX);
    
    if (length(calculatedNormal) > 0.001) {
        newNormal = normalize(calculatedNormal);
    } else {
        newNormal = normal; // Fallback to original normal to prevent black artifacts
    }

    // Flip if pointing inward (dot check with original normal)
    if (dot(newNormal, normal) < 0.0) newNormal = -newNormal;

    // Pass data to fragment
    vStumpNormal = normalize(mat3(modelMatrix) * newNormal);
    vec4 worldPos = modelMatrix * vec4(displacedPos, 1.0);
    vStumpWorldPos = worldPos.xyz;
    vStumpHeight = displacedPos.y; // Pass local height to fragment
    
    csm_Position = displacedPos;
    csm_Normal = newNormal; // Update internal THREE normal
  }
`;

const stumpFragment = `
  uniform sampler3D uNoise;
  uniform vec3 uWoodColor;
  uniform vec3 uBarkColor;
  uniform vec3 uMossColor;
  
  varying vec3 vStumpWorldPos;
  varying vec3 vStumpNormal;
  varying float vStumpHeight; // Receive height

  float getNoise(vec3 pos, float scale) {
      return texture(uNoise, pos * scale).r;
  }

  void main() {
    // 1. High-Res Detail Noise
    float detail = getNoise(vStumpWorldPos, 3.0);
    float broad = getNoise(vStumpWorldPos, 0.8);
    
    // 2. Base Wood Texture (Weathered)
    vec3 col = mix(uBarkColor, uWoodColor, detail);
    
    // Add some vertical striations
    float striation = getNoise(vStumpWorldPos * vec3(5.0, 0.5, 5.0), 1.0);
    col *= (0.8 + 0.4 * striation);

    // 3. Moss Layer (Procedural)
    // Moss grows on top surfaces (upDot > threshold) AND in crevices (detail < threshold)
    float upDot = dot(vStumpNormal, vec3(0.0, 1.0, 0.0));
    float mossFactor = smoothstep(0.4, 0.8, upDot) * 0.8; // Top surfaces
    mossFactor += smoothstep(0.6, 0.8, detail) * 0.4 * broad; // Patches
    
    col = mix(col, uMossColor, clamp(mossFactor, 0.0, 1.0));

    // 4. Ground Occlusion (Softens the transition to terrain)
    // Use vStumpHeight (local Y) instead of modelMatrix which is unavailable in fragment shader
    float groundOcc = smoothstep(-0.5, 0.5, vStumpHeight + 0.5); 
    col *= (0.5 + 0.5 * groundOcc);

    // 5. Inner Hollow Darkness
    if (!gl_FrontFacing) {
        col *= 0.25; // Darken inside significantly
    }

    csm_DiffuseColor = vec4(col, 1.0);
    csm_Roughness = 0.9; // Matte bark
  }
`;

interface RootHollowProps {
    position: [number, number, number];
    normal?: number[]; // [nx, ny, nz]
}

/**
 * RootHollow component - AAA Quality Procedural Stump
 * Features:
 * - Finite Difference Normal Recomputation for correct lighting
 * - Smooth, organic root flares matching slope
 * - High-poly geometry for clean displacement
 */
export const RootHollow: React.FC<RootHollowProps> = ({ position, normal = [0, 1, 0] }) => {
    const [status, setStatus] = useState<'IDLE' | 'GROWING'>('IDLE');
    const consumeFlora = useGameStore(s => s.consumeFlora);
    const placedFloras = useGameStore(s => s.placedFloras);
    const meshRef = useRef<THREE.Mesh>(null);
    const posVec = useMemo(() => new THREE.Vector3(...position), [position]);

    const timeUniformRef = useRef({ value: 0 });
    const uniforms = useMemo(() => ({
        uNoise: { value: getNoiseTexture() },
        uWoodColor: { value: STUMP_CONFIG.woodColor },
        uBarkColor: { value: STUMP_CONFIG.barkColor },
        uMossColor: { value: STUMP_CONFIG.mossColor },
        uTime: timeUniformRef.current
    }), []);

    // Update time uniform for animation
    useFrame((state) => {
        timeUniformRef.current.value = state.clock.elapsedTime;
    });

    // Orientation Logic: Align the stump to the terrain normal
    const quaternion = useMemo(() => {
        const up = new THREE.Vector3(0, 1, 0);
        // Use primitive values from the array to avoid re-running on new array references
        const nx = normal[0] || 0;
        const ny = normal[1] || 1;
        const nz = normal[2] || 0;
        
        // GRAVITROPISM FIX:
        // Trees grow mostly UP, not perpendicular to the slope.
        // We blend the terrain normal with the world UP vector.
        const terrainNormal = new THREE.Vector3(nx, ny, nz).normalize();
        const targetDirection = new THREE.Vector3()
            .copy(terrainNormal)
            .lerp(up, 0.7) // 70% Up, 30% Slope. This prevents extreme sideways tilting.
            .normalize();
        
        // Create quaternion that rotates UP to the Target Direction
        const q = new THREE.Quaternion().setFromUnitVectors(up, targetDirection);
        
        // Deterministic random rotation based on position
        const hash = Math.abs(Math.sin(position[0] * 12.9898 + position[2] * 78.233) * 43758.5453);
        const randomAngle = (hash % 1) * Math.PI * 2;
        
        const randomYaw = new THREE.Quaternion().setFromAxisAngle(targetDirection, randomAngle);
        q.multiply(randomYaw);
        
        return q;
    }, [normal[0], normal[1], normal[2], position[0], position[2]]);

    const geometry = useMemo(() => {
        const topRadius = 0.8 * STUMP_CONFIG.scale;
        const bottomRadius = 1.4 * STUMP_CONFIG.scale; // Much wider base for roots
        const height = STUMP_CONFIG.height * STUMP_CONFIG.scale;
        
        // High Resolution Geometry for smooth displacement
        // 128 radial segments for smooth roots, 32 height segments for vertical detail
        const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 128, 32, true);
        geo.translate(0, height / 2, 0); 
        return geo;
    }, []);

    useFrame(() => {
        if (status !== 'IDLE') return;
        for (const flora of placedFloras) {
             const body = flora.bodyRef?.current;
             if (!body) continue;
             const fPos = body.translation();
             const distSq = (fPos.x - posVec.x)**2 + (fPos.y - posVec.y)**2 + (fPos.z - posVec.z)**2;
             if (distSq < 2.25) {
                 const vel = body.linvel();
                 if (vel.x**2 + vel.y**2 + vel.z**2 < 0.01) {
                     consumeFlora(flora.id);
                     setStatus('GROWING');
                 }
             }
        }
    });

    const scaledHeight = STUMP_CONFIG.height * STUMP_CONFIG.scale;
    const scaledRadius = 1.4 * STUMP_CONFIG.scale;

    return (
        // Lower the group slightly (-0.3) so the flared roots embed into the terrain
        <group position={[position[0], position[1] - 0.3, position[2]]} quaternion={quaternion}>
            <RigidBody type="fixed" colliders={false}>
                <group position={[0, scaledHeight / 2, 0]}>
                    <CylinderCollider args={[scaledHeight / 2, scaledRadius * 0.6]} />
                </group>
                <mesh 
                    ref={meshRef}
                    castShadow 
                    receiveShadow
                    geometry={geometry}
                >
                    <CustomShaderMaterial
                        baseMaterial={THREE.MeshStandardMaterial}
                        vertexShader={stumpVertex}
                        fragmentShader={stumpFragment}
                        uniforms={uniforms}
                        side={THREE.DoubleSide}
                        roughness={0.9}
                        toneMapped={false}
                    />
                </mesh>
            </RigidBody>

            {status === 'GROWING' && (
                <FractalTree
                    seed={Math.abs(position[0] * 31 + position[2] * 17)}
                    position={new THREE.Vector3(0, -0.2, 0)}
                />
            )}
        </group>
    );
};
