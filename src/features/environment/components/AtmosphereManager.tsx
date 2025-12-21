import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { calculateOrbitAngle as calculateOrbitAngleCore, getOrbitOffset } from '@core/graphics/celestial';

/**
 * Shared Helper Functions for Celestial Rendering
 */

const calculateOrbitAngle = (t: number, speed: number, offset: number = 0): number => {
    return calculateOrbitAngleCore(t, speed, offset);
};

const getSunColor = (sunY: number, radius: number): THREE.Color => {
    const normalizedHeight = sunY / radius;
    const nightColor = new THREE.Color(0x3a4a6a);
    const sunriseSunsetColor = new THREE.Color(0xff6a33);
    const middayColor = new THREE.Color(0xfffdf5);
    const goldenHourColor = new THREE.Color(0xffd580);

    if (normalizedHeight < -0.15) {
        return nightColor;
    } else if (normalizedHeight < 0.0) {
        const t = (normalizedHeight + 0.15) / 0.15;
        return new THREE.Color().lerpColors(nightColor, sunriseSunsetColor, t);
    } else if (normalizedHeight < 0.25) {
        const t = normalizedHeight / 0.25;
        return new THREE.Color().lerpColors(sunriseSunsetColor, goldenHourColor, t);
    } else if (normalizedHeight < 0.5) {
        const t = (normalizedHeight - 0.25) / 0.25;
        return new THREE.Color().lerpColors(goldenHourColor, middayColor, t);
    } else {
        return middayColor;
    }
};

const getSunGlowColor = (normalizedHeight: number, sunColor: THREE.Color): THREE.Color => {
    const glowColor = sunColor.clone();
    const nightGlow = new THREE.Color(0x4a5a7a);
    const warmGlow = new THREE.Color(0xff9b4a);
    const dayHighlight = new THREE.Color(0xfff4d6);

    if (normalizedHeight < -0.15) {
        glowColor.lerp(nightGlow, 0.7).multiplyScalar(0.45);
        return glowColor;
    }
    if (normalizedHeight < 0.0) {
        const t = THREE.MathUtils.clamp((normalizedHeight + 0.15) / 0.15, 0, 1);
        glowColor.lerp(nightGlow, 1 - t).multiplyScalar(0.5 + 0.4 * t);
        return glowColor;
    }
    if (normalizedHeight < 0.3) {
        glowColor.lerp(warmGlow, 0.35).multiplyScalar(1.15);
        return glowColor;
    }
    return glowColor.lerp(dayHighlight, 0.2).multiplyScalar(1.05);
};

const getSkyGradient = (sunY: number, radius: number): { top: THREE.Color, bottom: THREE.Color } => {
    const normalizedHeight = sunY / radius;
    const nightTop = new THREE.Color(0x020210);
    const nightBottom = new THREE.Color(0x101025);
    const sunsetTop = new THREE.Color(0x2c3e50);
    const sunsetBottom = new THREE.Color(0xff8c42);
    const dayTop = new THREE.Color(0x1e90ff);
    const dayBottom = new THREE.Color(0x87CEEB);

    if (normalizedHeight < -0.15) {
        return { top: nightTop, bottom: nightBottom };
    } else if (normalizedHeight < 0.0) {
        const t = (normalizedHeight + 0.15) / 0.15;
        return {
            top: new THREE.Color().lerpColors(nightTop, sunsetTop, t),
            bottom: new THREE.Color().lerpColors(nightBottom, sunsetBottom, t)
        };
    } else if (normalizedHeight < 0.3) {
        const t = normalizedHeight / 0.3;
        return {
            top: new THREE.Color().lerpColors(sunsetTop, dayTop, t),
            bottom: new THREE.Color().lerpColors(sunsetBottom, dayBottom, t)
        };
    } else {
        return { top: dayTop, bottom: dayBottom };
    }
};

/**
 * Components
 */

export const AmbientController: React.FC<{ intensityMul?: number }> = ({ intensityMul = 1.0 }) => {
    const ambientRef = useRef<THREE.AmbientLight>(null);
    const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
    const surfaceAmbient = useMemo(() => new THREE.Color('#ccccff'), []);
    const caveAmbient = useMemo(() => new THREE.Color('#556070'), []);

    useFrame(() => {
        if (!ambientRef.current) return;
        ambientRef.current.intensity = THREE.MathUtils.lerp(0.3, 0.14, undergroundBlend) * intensityMul;
        ambientRef.current.color.copy(surfaceAmbient).lerp(caveAmbient, undergroundBlend);
    });

    return <ambientLight ref={ambientRef} intensity={0.3} color="#ccccff" />;
};

export const SkyDomeRefLink: React.FC<{
    gradientRef: React.MutableRefObject<{ top: THREE.Color, bottom: THREE.Color }>;
    orbitConfig: { speed: number; offset: number };
}> = ({ gradientRef, orbitConfig }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const uniforms = useMemo(() => ({
        uTopColor: { value: new THREE.Color('#87CEEB') },
        uBottomColor: { value: new THREE.Color('#87CEEB') },
        uExponent: { value: 0.6 },
        uTime: { value: 0 },
        uNightMix: { value: 0 }
    }), []);

    useFrame((state) => {
        if (meshRef.current) {
            meshRef.current.position.copy(state.camera.position);
            uniforms.uTopColor.value.copy(gradientRef.current.top);
            uniforms.uBottomColor.value.copy(gradientRef.current.bottom);
            uniforms.uTime.value = state.clock.getElapsedTime();
            const angle = calculateOrbitAngle(state.clock.getElapsedTime(), orbitConfig.speed, orbitConfig.offset);
            const sunHeight = Math.cos(angle);
            uniforms.uNightMix.value = 1.0 - THREE.MathUtils.smoothstep(sunHeight, -0.4, -0.1);
        }
    });

    return (
        <mesh ref={meshRef} scale={[400, 400, 400]}>
            <sphereGeometry args={[1, 32, 32]} />
            <shaderMaterial
                side={THREE.BackSide}
                depthWrite={false}
                fog={false}
                uniforms={uniforms}
                vertexShader={`
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
                fragmentShader={`
          uniform vec3 uTopColor;
          uniform vec3 uBottomColor;
          uniform float uExponent;
          uniform float uTime;
          uniform float uNightMix;
          varying vec3 vWorldPosition;

          float hash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
          }

          float noise(vec3 x) {
            vec3 p = floor(x);
            vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            float n = p.x + p.y * 57.0 + 113.0 * p.z;
            return mix(mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
                           mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
                       mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
                           mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y), f.z);
          }

          float fbm(vec3 x) {
            float v = 0.0;
            float a = 0.5;
            for(int i=0; i<3; ++i) {
              v += a * noise(x);
              x *= 2.0;
              a *= 0.5;
            }
            return v;
          }

          mat3 rotateY(float t) {
            float c = cos(t);
            float s = sin(t);
            return mat3(
              c, 0.0, -s,
              0.0, 1.0, 0.0,
              s, 0.0, c
            );
          }

          void main() {
            vec3 skyDir = normalize(vWorldPosition);
            vec3 skyPos = rotateY(-uTime * 0.01) * skyDir;
            float h = skyDir.y;
            float p = max(0.0, (h + 0.2) / 1.2);
            p = pow(p, uExponent);
            vec3 finalColor = mix(uBottomColor, uTopColor, p);

            if (uNightMix > 0.01) {
              vec3 starCoord = skyPos * 350.0;
              float s = hash(floor(starCoord));
              if (s > 0.9985) {
                vec3 maskDir = rotateY(uTime * 0.02) * skyDir; 
                float atmosphere = noise(maskDir * 20.0);
                float twinkle = 0.4 + 0.6 * atmosphere;
                vec3 f = fract(starCoord) - 0.5;
                float d = length(f);
                float starShape = max(0.0, 1.0 - d * 2.5);
                starShape = pow(starShape, 3.0);
                float starIntensity = starShape * twinkle * 2.5;
                vec3 starCol = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.9, 0.6), fract(s * 10.0));
                float horizonFade = smoothstep(-0.1, 0.3, h);
                finalColor += starCol * starIntensity * uNightMix * horizonFade;
              }
              float cloud = fbm(skyPos * 2.0); 
              float cloud2 = fbm(skyPos * 4.0 + vec3(1.0));
              float nebMask = smoothstep(0.4, 0.8, cloud * cloud2);
              vec3 nebColor = mix(vec3(0.02, 0.0, 0.05), vec3(0.05, 0.02, 0.08), cloud);
              finalColor += nebColor * nebMask * uNightMix * 1.2;
            }
            gl_FragColor = vec4(finalColor, 1.0);
          }
        `}
            />
        </mesh>
    );
};

export const SunFollower: React.FC<{
    sunDirection?: THREE.Vector3;
    intensityMul?: number;
    shadowConfig?: {
        bias: number;
        normalBias: number;
        mapSize: number;
        camSize: number;
    };
    orbitConfig?: {
        radius: number;
        speed: number;
        offset: number;
    };
}> = ({
    sunDirection,
    intensityMul = 1.0,
    shadowConfig = {
        bias: -0.0005,
        normalBias: 0.02,
        mapSize: 2048,
        camSize: 200
    },
    orbitConfig = { radius: 300, speed: 0.025, offset: 0 }
}) => {
        const { camera } = useThree();
        const lightRef = useRef<THREE.DirectionalLight>(null);
        const sunMeshRef = useRef<THREE.Mesh>(null);
        const sunMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
        const glowMeshRef = useRef<THREE.Mesh>(null);
        const glowMaterialRef = useRef<THREE.ShaderMaterial>(null);
        const target = useMemo(() => new THREE.Object3D(), []);
        const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
        const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);
        const skyVisibility = useEnvironmentStore((s) => s.skyVisibility);

        const smoothSunPos = useRef(new THREE.Vector3());
        const lastCameraPos = useRef(new THREE.Vector3());
        const tmpDelta = useRef(new THREE.Vector3());
        const tmpLightOffset = useRef(new THREE.Vector3());
        const tmpVisualOffset = useRef(new THREE.Vector3());
        const tmpTargetSunPos = useRef(new THREE.Vector3());

        useEffect(() => {
            lastCameraPos.current.copy(camera.position);
            smoothSunPos.current.set(0, 0, 0);
        }, [camera]);

        useFrame(({ clock }) => {
            if (lightRef.current) {
                const t = clock.getElapsedTime();
                const { radius, speed, offset } = orbitConfig;
                const angle = calculateOrbitAngle(t, speed, offset);

                getOrbitOffset(tmpLightOffset.current, angle, radius, 0, 30);
                tmpDelta.current.copy(camera.position).sub(lastCameraPos.current);
                smoothSunPos.current.add(tmpDelta.current);
                lastCameraPos.current.copy(camera.position);

                const sunDist = 350;
                getOrbitOffset(tmpVisualOffset.current, angle, sunDist, 0, 30);
                tmpTargetSunPos.current.set(
                    smoothSunPos.current.x + tmpVisualOffset.current.x,
                    tmpVisualOffset.current.y,
                    smoothSunPos.current.z + tmpVisualOffset.current.z
                );

                const q = 4;
                const lx = Math.round(camera.position.x / q) * q;
                const lz = Math.round(camera.position.z / q) * q;

                lightRef.current.position.set(lx + tmpLightOffset.current.x, tmpLightOffset.current.y, lz + tmpLightOffset.current.z);
                target.position.set(lx, 0, lz);
                lightRef.current.target = target;
                lightRef.current.updateMatrixWorld();
                target.updateMatrixWorld();

                if (sunDirection) {
                    sunDirection.copy(tmpLightOffset.current).normalize();
                }

                const sy = tmpLightOffset.current.y;
                const sunColor = getSunColor(sy, radius);
                lightRef.current.color.copy(sunColor);

                const normalizedHeight = sy / radius;
                let baseIntensity = 1.0;
                if (normalizedHeight < -0.15) baseIntensity = 0.1;
                else if (normalizedHeight < 0.0) baseIntensity = 0.1 + (0.4 - 0.1) * ((normalizedHeight + 0.15) / 0.15);
                else if (normalizedHeight < 0.3) baseIntensity = 0.4 + (1.0 - 0.4) * (normalizedHeight / 0.3);
                else baseIntensity = 1.0;

                const skyOpen = THREE.MathUtils.smoothstep(skyVisibility, 0.08, 0.45);
                // AAA FIX: Don't turn off sun light completely underwater. 
                // Terrain shader needs direct light for MeshStandardMaterial to work.
                // We dim it significantly to simulate absorption, but keep it active for caustics and visibility.
                const waterBlock = THREE.MathUtils.smoothstep(underwaterBlend, 0.05, 0.5) * 0.65; // Max 65% reduction
                const directVis = skyOpen * (1.0 - waterBlock);
                const depthFade = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
                const sunDimming = THREE.MathUtils.lerp(1.0, 0.55, depthFade);

                lightRef.current.intensity = baseIntensity * sunDimming * directVis * intensityMul;

                if (sunMeshRef.current) {
                    sunMeshRef.current.position.copy(tmpTargetSunPos.current);
                    sunMeshRef.current.lookAt(camera.position);
                    sunMeshRef.current.visible = directVis > 0.02;

                    if (sunMaterialRef.current) {
                        const sunMeshColor = sunColor.clone();
                        if (normalizedHeight < -0.15) sunMeshColor.multiplyScalar(0.4);
                        else if (normalizedHeight < 0.0) sunMeshColor.multiplyScalar(0.4 + (1.2 - 0.4) * ((normalizedHeight + 0.15) / 0.15));
                        else sunMeshColor.multiplyScalar(5.0);

                        const depthFade2 = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
                        sunMeshColor.multiplyScalar(THREE.MathUtils.lerp(1.0, 0.35, depthFade2));
                        sunMaterialRef.current.transparent = true;
                        sunMaterialRef.current.opacity = THREE.MathUtils.clamp(directVis, 0, 1);
                        sunMaterialRef.current.color.copy(sunMeshColor);
                    }

                    if (glowMeshRef.current && glowMaterialRef.current) {
                        const toCam = tmpDelta.current.copy(camera.position).sub(tmpTargetSunPos.current).normalize();
                        glowMeshRef.current.position.copy(tmpTargetSunPos.current).addScaledVector(toCam, 2.0);
                        glowMeshRef.current.lookAt(camera.position);
                        glowMeshRef.current.visible = directVis > 0.02;

                        const sunsetBoost = normalizedHeight >= 0.0 ? THREE.MathUtils.clamp(1.0 - THREE.MathUtils.smoothstep(normalizedHeight, 0.22, 0.35), 0, 1) : 0.0;
                        const glowScale = THREE.MathUtils.lerp(3.5, 5.0, sunsetBoost);
                        const baseGlowOpacity = (normalizedHeight < -0.15 ? 0.2 : 0.5);
                        const glowOpacityBase = THREE.MathUtils.lerp(baseGlowOpacity, 0.9, sunsetBoost);
                        const depthFade3 = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
                        const glowOpacity = glowOpacityBase * THREE.MathUtils.lerp(1.0, 0.25, depthFade3) * THREE.MathUtils.clamp(directVis, 0, 1);

                        glowMeshRef.current.scale.setScalar(glowScale);
                        const glowColor = getSunGlowColor(normalizedHeight, sunColor);
                        glowMaterialRef.current.uniforms.uColor.value.copy(glowColor);
                        glowMaterialRef.current.uniforms.uOpacity.value = glowOpacity;
                        glowMaterialRef.current.uniforms.uTime.value = t;
                    }
                }
            }
        });

        return (
            <>
                <directionalLight
                    ref={lightRef}
                    color="#fffcf0"
                    castShadow
                    shadow-bias={shadowConfig.bias}
                    shadow-normalBias={shadowConfig.normalBias}
                    shadow-mapSize={[shadowConfig.mapSize, shadowConfig.mapSize]}
                    shadow-camera-near={10}
                    shadow-camera-far={500}
                    shadow-camera-left={-shadowConfig.camSize}
                    shadow-camera-right={shadowConfig.camSize}
                    shadow-camera-top={shadowConfig.camSize}
                    shadow-camera-bottom={-shadowConfig.camSize}
                />
                <primitive object={target} />
                <mesh ref={sunMeshRef}>
                    <sphereGeometry args={[15, 32, 32]} />
                    <meshBasicMaterial ref={sunMaterialRef} color="#fffee0" toneMapped={false} fog={false} />
                </mesh>
                <mesh ref={glowMeshRef}>
                    <planeGeometry args={[250, 250]} />
                    <shaderMaterial
                        ref={glowMaterialRef}
                        transparent
                        depthWrite={false}
                        fog={false}
                        blending={THREE.AdditiveBlending}
                        uniforms={{
                            uColor: { value: new THREE.Color() },
                            uOpacity: { value: 0.25 },
                            uTime: { value: 0 }
                        }}
                        vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
                        fragmentShader={`
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying vec2 vUv;
            float hash(float n) { return fract(sin(n) * 43758.5453123); }
            float noise(float p) {
                float fl = floor(p);
                float fc = fract(p);
                return mix(hash(fl), hash(fl + 1.0), fc);
            }
            void main() {
              vec2 centered = vUv - 0.5;
              float dist = length(centered);
              float mask = smoothstep(0.5, 0.46, dist);
              if (mask <= 0.0) discard;
              float angle = atan(centered.y, centered.x);
              float t = uTime;
              float coreInner = 1.0 / (dist * 45.0 + 0.4);
              coreInner = pow(coreInner, 3.2);
              float coreMid = 1.0 / (dist * 20.0 + 0.8);
              coreMid = pow(coreMid, 2.0);
              float core = coreInner * 1.2 + coreMid * 0.4;
              float halo = exp(-dist * 12.0) * 0.3;
              halo += exp(-dist * 4.5) * 0.15;
              float rayA = noise(angle * 6.0 + t * 0.15);
              float rayB = noise(angle * 18.0 - t * 0.45);
              float rayC = noise(angle * 42.0 + t * 1.2);
              float rays = (rayA * 0.5 + rayB * 0.3 + rayC * 0.2);
              rays = pow(max(0.0, rays), 5.5);
              float rayLen = 0.1 + 0.08 * noise(angle * 4.0 + t * 0.1);
              float rayMask = smoothstep(rayLen, 0.0, dist);
              float finalGlow = core + halo + (rays * rayMask * 2.5);
              vec3 coreCol = vec3(1.0, 1.0, 0.95);
              vec3 scatteringCol = uColor;
              vec3 finalColor = mix(scatteringCol, coreCol, clamp(core * 0.8, 0.0, 1.0));
              float fringe = smoothstep(0.4, 0.5, dist);
              finalColor.r += fringe * 0.05;
              finalColor.b -= fringe * 0.05;
              gl_FragColor = vec4(finalColor, finalGlow * uOpacity * mask);
            }
          `}
                    />
                </mesh>
            </>
        );
    };

export const MoonFollower: React.FC<{
    intensityMul?: number;
    orbitConfig?: {
        radius: number;
        speed: number;
        offset: number;
    };
}> = ({
    intensityMul = 1.0,
    orbitConfig = { radius: 300, speed: 0.025, offset: 0 }
}) => {
        const { camera } = useThree();
        const moonMeshRef = useRef<THREE.Mesh>(null);
        const lightRef = useRef<THREE.DirectionalLight>(null);
        const target = useMemo(() => new THREE.Object3D(), []);
        const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
        const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);
        const skyVisibility = useEnvironmentStore((s) => s.skyVisibility);
        const tmpLightOffset = useRef(new THREE.Vector3());
        const tmpVisualOffset = useRef(new THREE.Vector3());

        useFrame(({ clock }) => {
            if (!moonMeshRef.current || !lightRef.current) return;
            const t = clock.getElapsedTime();
            const { radius, speed, offset } = orbitConfig;
            const angle = calculateOrbitAngle(t, speed, offset + Math.PI);
            const visualDistance = 1200;
            getOrbitOffset(tmpVisualOffset.current, angle, visualDistance, 0, 30);
            const mPx = camera.position.x + tmpVisualOffset.current.x;
            const mPy = tmpVisualOffset.current.y;
            const mPz = camera.position.z + tmpVisualOffset.current.z;
            moonMeshRef.current.position.set(mPx, mPy, mPz);
            getOrbitOffset(tmpLightOffset.current, angle, radius, 0, 30);
            const lPx = camera.position.x + tmpLightOffset.current.x;
            const lPy = tmpLightOffset.current.y;
            const lPz = camera.position.z + tmpLightOffset.current.z;
            lightRef.current.position.set(lPx, lPy, lPz);
            target.position.set(camera.position.x, 0, camera.position.z);
            lightRef.current.target = target;
            lightRef.current.updateMatrixWorld();

            const isAboveHorizon = mPy > -150;
            const skyOpen = THREE.MathUtils.smoothstep(skyVisibility, 0.08, 0.45);
            const waterBlock = THREE.MathUtils.smoothstep(underwaterBlend, 0.05, 0.35);
            const directVis = skyOpen * (1.0 - waterBlock);
            const moonMat = moonMeshRef.current.material as THREE.ShaderMaterial;
            if (moonMat.uniforms && moonMat.uniforms.uOpacity) {
                moonMat.uniforms.uOpacity.value = THREE.MathUtils.clamp(directVis, 0, 1);
            }
            moonMeshRef.current.visible = isAboveHorizon && directVis > 0.02;
            const depthFade = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
            const moonDimming = THREE.MathUtils.lerp(1.0, 0.35, depthFade);
            lightRef.current.intensity = (lPy > -50) ? 0.2 * moonDimming * directVis * intensityMul : 0;
            if (undergroundBlend > 0.85) moonMeshRef.current.visible = false;
        });

        return (
            <>
                <directionalLight ref={lightRef} color="#e0e8ff" />
                <primitive object={target} />
                <mesh ref={moonMeshRef}>
                    <sphereGeometry args={[12, 32, 32]} />
                    <shaderMaterial
                        transparent
                        uniforms={{ uOpacity: { value: 1.0 } }}
                        vertexShader={`
              varying vec2 vUv;
              varying vec3 vNormal;
              varying vec3 vViewDir;
              void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-mvPosition.xyz);
                gl_Position = projectionMatrix * mvPosition;
              }
            `}
                        fragmentShader={`
              uniform float uOpacity;
              varying vec2 vUv;
              varying vec3 vNormal;
              varying vec3 vViewDir;
              float hash(vec2 p) { return fract(sin(dot(p, vec2(12.7, 7.3))) * 437.5); }
              float noise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
                return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
              }
              void main() {
                float n = noise(vUv * 8.0) * 0.5 + noise(vUv * 16.0) * 0.25;
                vec3 baseColor = vec3(0.85, 0.85, 0.9);
                vec3 craterColor = vec3(0.65, 0.65, 0.7);
                vec3 color = mix(baseColor, craterColor, n);
                float fresnel = pow(1.0 - max(0.0, dot(vNormal, vViewDir)), 3.0);
                color += vec3(0.2, 0.3, 0.5) * fresnel;
                float dist = length(vUv - 0.5);
                float shadow = smoothstep(0.5, 0.4, dist);
                gl_FragColor = vec4(color, uOpacity * shadow);
              }
            `}
                    />
                </mesh>
            </>
        );
    };

export const AtmosphereController: React.FC<{
    orbitConfig: { speed: number; offset: number };
}> = ({ orbitConfig }) => {
    const { scene } = useThree();
    const gradientRef = useRef({ top: new THREE.Color(), bottom: new THREE.Color() });

    useFrame(({ clock }) => {
        const t = clock.getElapsedTime();
        const angle = calculateOrbitAngle(t, orbitConfig.speed, orbitConfig.offset);
        const radius = 300;
        const sunY = Math.cos(angle) * radius;
        const grads = getSkyGradient(sunY, radius);
        gradientRef.current.top.copy(grads.top);
        gradientRef.current.bottom.copy(grads.bottom);

        if (scene.fog) {
            scene.fog.color.copy(grads.bottom);
        }
    });

    return (
        <>
            <SkyDomeRefLink gradientRef={gradientRef} orbitConfig={orbitConfig} />
        </>
    );
};

export const AtmosphereManager: React.FC<{
    sunDirection: THREE.Vector3;
    sunIntensityMul: number;
    sunShadowBias: number;
    sunShadowNormalBias: number;
    sunShadowMapSize: number;
    sunShadowCamSize: number;
    ambientIntensityMul: number;
    moonIntensityMul: number;
    fogNear: number;
    fogFar: number;
    viewDistance: number;
    orbitConfig: { radius: number; speed: number; offset: number };
}> = (props) => {
    return (
        <>
            <color attach="background" args={['#87CEEB']} />
            <fog attach="fog" args={['#87CEEB', props.fogNear, props.fogFar * props.viewDistance]} />
            <AmbientController intensityMul={props.ambientIntensityMul} />
            <AtmosphereController
                orbitConfig={props.orbitConfig}
            />
            <SunFollower
                sunDirection={props.sunDirection}
                intensityMul={props.sunIntensityMul}
                shadowConfig={{
                    bias: props.sunShadowBias,
                    normalBias: props.sunShadowNormalBias,
                    mapSize: props.sunShadowMapSize,
                    camSize: props.sunShadowCamSize
                }}
                orbitConfig={props.orbitConfig}
            />
            <MoonFollower
                intensityMul={props.moonIntensityMul}
                orbitConfig={props.orbitConfig}
            />
        </>
    );
};
