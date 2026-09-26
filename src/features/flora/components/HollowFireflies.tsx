import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface HollowFirefliesProps {
    /** Number of motes (default: 3) */
    count?: number;
    /** Radius they drift around the hollow (default: 1.5) */
    radius?: number;
    /** Height range above the hollow (default: [0.5, 2.0]) */
    heightRange?: [number, number];
    /** Base seed for deterministic positioning */
    seed?: number;
}

const VERT = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    // Slow, uneven blink: mostly a faint glow, now and then a soft swell.
    float blink = pow(max(0.0, sin(uTime * 0.9 + aPhase * 6.2831)), 3.0);
    vAlpha = 0.35 + 0.65 * blink;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (26.0 + 14.0 * blink) * uPixelRatio / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float core = exp(-d * d * 18.0);
    float halo = exp(-d * d * 3.5) * 0.35;
    float a = (core + halo) * vAlpha;
    if (a < 0.003) discard;
    vec3 col = mix(vec3(0.55, 0.92, 0.86), vec3(0.95, 1.0, 0.97), core);
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * HollowFireflies - a few Lumina motes drifting around a Root Hollow.
 *
 * Soft additive points (no geometry), blinking slowly out of phase, so a
 * dormant hollow reads as quietly alive rather than marked by UI dots.
 */
export const HollowFireflies: React.FC<HollowFirefliesProps> = ({
    count = 3,
    radius = 1.5,
    heightRange = [0.5, 2.0],
    seed = 42
}) => {
    const pointsRef = useRef<THREE.Points>(null);

    const anchors = useMemo(() => {
        const hash = (n: number) => {
            const x = Math.sin(n) * 43758.5453;
            return x - Math.floor(x);
        };
        return Array.from({ length: count }, (_, i) => {
            const angle = (i / count) * Math.PI * 2 + hash(seed + i) * 0.5;
            const r = radius * (0.7 + hash(seed * 13.3 + i) * 0.6);
            return {
                x: Math.cos(angle) * r,
                y: heightRange[0] + hash(seed * 7.9 + i * 17.3) * (heightRange[1] - heightRange[0]),
                z: Math.sin(angle) * r,
                phase: hash(seed * 3.1 + i * 5.7),
            };
        });
    }, [count, radius, heightRange, seed]);

    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        g.setAttribute('aPhase', new THREE.BufferAttribute(Float32Array.from(anchors.map((a) => a.phase)), 1));
        return g;
    }, [count, anchors]);

    const material = useMemo(() => new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
    }), []);

    useFrame((state) => {
        const time = state.clock.elapsedTime;
        material.uniforms.uTime.value = time;
        const pos = geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
            const a = anchors[i];
            // Lazy drift around each anchor.
            pos.setXYZ(
                i,
                a.x + Math.sin(time * 0.31 + i * 2.1) * 0.35,
                a.y + Math.sin(time * 0.43 + i * 1.3) * 0.25,
                a.z + Math.cos(time * 0.27 + i * 1.7) * 0.35,
            );
        }
        pos.needsUpdate = true;
    });

    return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
};
