import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { calculateOrbitAngle as calculateOrbitAngleCore, getOrbitOffset } from '@core/graphics/celestial';
import { frameProfiler } from '@core/utils/FrameProfiler';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

/** Shadow map refresh rate for moving casters (the sun itself moves slowly). */
const SHADOW_UPDATE_HZ = 15;

/** Hemisphere sky-fill intensities (see AmbientController). */
const SKY_FILL_DAY = 0.8; // sun:sky ~6:1 so light has a clear direction
const SKY_FILL_NIGHT = 0.16;
const SKY_FILL_CAVE = 0.05;

/**
 * Shared Helper Functions for Celestial Rendering
 */

const calculateOrbitAngle = (t: number, speed: number, offset: number = 0): number => {
    return calculateOrbitAngleCore(t, speed, offset);
};

// Immutable palette entries are shared; frame loops write into caller-owned scratch colors.
const SUN_NIGHT = new THREE.Color(0x3a4a6a);
const SUN_SUNSET = new THREE.Color(0xff6a33);
const SUN_MIDDAY = new THREE.Color(0xfffdf5);
const SUN_GOLDEN = new THREE.Color(0xffd580);
const GLOW_NIGHT = new THREE.Color(0x4a5a7a);
const GLOW_WARM = new THREE.Color(0xffb070);
const GLOW_DAY = new THREE.Color(0xfff4d6);
const SKY_NIGHT_TOP = new THREE.Color(0x03050d);
const SKY_NIGHT_BOTTOM = new THREE.Color(0x0d1626);
const SKY_SUNSET_TOP = new THREE.Color(0x2a3358); // deep indigo
const SKY_SUNSET_BOTTOM = new THREE.Color(0xe39a6a); // soft amber, not orange
const SKY_DAY_TOP = new THREE.Color(0x4a7fb8); // calm blue
const SKY_DAY_BOTTOM = new THREE.Color(0xbcd4de); // pale haze at the horizon
const CAVE_FOG = new THREE.Color(0x07090b);

const getSunColor = (sunY: number, radius: number, out: THREE.Color): THREE.Color => {
    const normalizedHeight = sunY / radius;

    if (normalizedHeight < -0.15) {
        return out.copy(SUN_NIGHT);
    } else if (normalizedHeight < 0.0) {
        const t = (normalizedHeight + 0.15) / 0.15;
        return out.lerpColors(SUN_NIGHT, SUN_SUNSET, t);
    } else if (normalizedHeight < 0.25) {
        const t = normalizedHeight / 0.25;
        return out.lerpColors(SUN_SUNSET, SUN_GOLDEN, t);
    } else if (normalizedHeight < 0.5) {
        const t = (normalizedHeight - 0.25) / 0.25;
        return out.lerpColors(SUN_GOLDEN, SUN_MIDDAY, t);
    } else {
        return out.copy(SUN_MIDDAY);
    }
};

const getSunGlowColor = (normalizedHeight: number, sunColor: THREE.Color, out: THREE.Color): THREE.Color => {
    const glowColor = out.copy(sunColor);

    if (normalizedHeight < -0.15) {
        glowColor.lerp(GLOW_NIGHT, 0.7).multiplyScalar(0.45);
        return glowColor;
    }
    if (normalizedHeight < 0.0) {
        const t = THREE.MathUtils.clamp((normalizedHeight + 0.15) / 0.15, 0, 1);
        glowColor.lerp(GLOW_NIGHT, 1 - t).multiplyScalar(0.5 + 0.4 * t);
        return glowColor;
    }
    // Sunset warm glow - reduced intensity and narrower range
    if (normalizedHeight < 0.15) {
        // Fade out warm glow as sun rises (0.0 -> 0.15)
        const warmFade = 1.0 - THREE.MathUtils.smoothstep(normalizedHeight, 0.0, 0.15);
        glowColor.lerp(GLOW_WARM, 0.2 * warmFade).multiplyScalar(1.0 + 0.1 * warmFade);
        return glowColor;
    }
    if (normalizedHeight < 0.3) {
        // Transition zone - minimal warm tint
        glowColor.lerp(GLOW_DAY, 0.15).multiplyScalar(1.02);
        return glowColor;
    }
    return glowColor.lerp(GLOW_DAY, 0.2).multiplyScalar(1.05);
};

const getSkyGradient = (
    sunY: number,
    radius: number,
    outTop: THREE.Color,
    outBottom: THREE.Color
): void => {
    const normalizedHeight = sunY / radius;

    if (normalizedHeight < -0.15) {
        outTop.copy(SKY_NIGHT_TOP);
        outBottom.copy(SKY_NIGHT_BOTTOM);
    } else if (normalizedHeight < 0.0) {
        const t = (normalizedHeight + 0.15) / 0.15;
        outTop.lerpColors(SKY_NIGHT_TOP, SKY_SUNSET_TOP, t);
        outBottom.lerpColors(SKY_NIGHT_BOTTOM, SKY_SUNSET_BOTTOM, t);
    } else if (normalizedHeight < 0.3) {
        const t = normalizedHeight / 0.3;
        outTop.lerpColors(SKY_SUNSET_TOP, SKY_DAY_TOP, t);
        outBottom.lerpColors(SKY_SUNSET_BOTTOM, SKY_DAY_BOTTOM, t);
    } else {
        outTop.copy(SKY_DAY_TOP);
        outBottom.copy(SKY_DAY_BOTTOM);
    }
};

/**
 * Components
 */

/**
 * Sky fill light.
 *
 * The baked voxel GI only scales surface albedo (it darkens enclosed spaces);
 * it never adds light. With just a 0.1 flat ambient, anything out of direct
 * sun rendered near-black. A hemisphere light supplies the sky's fill (cool
 * from above, warm ground bounce from below), scaled by sun height; caves stay
 * dark because GI still darkens their albedo, and the cave blend lowers it.
 */
export const AmbientController: React.FC<{ intensityMul?: number }> = ({ intensityMul = 1.0 }) => {
    const hemiRef = useRef<THREE.HemisphereLight>(null);
    const skyDay = useMemo(() => new THREE.Color('#bcd6ff'), []);
    const skyNight = useMemo(() => new THREE.Color('#3a4a78'), []);
    const groundDay = useMemo(() => new THREE.Color('#8a7a5a'), []);
    const groundNight = useMemo(() => new THREE.Color('#1e2230'), []);
    const caveTint = useMemo(() => new THREE.Color('#556070'), []);

    useFrame(() => {
        const hemi = hemiRef.current;
        if (!hemi) return;
        frameProfiler.begin('ambient-controller');
        // Read per frame (no React re-render while blends animate).
        const { undergroundBlend } = useEnvironmentStore.getState();
        const sunY = sharedUniforms.uSunDir.value.y;
        // Twilight keeps some sky light: the sky stays bright well after sunset,
        // so the land must not go black before it does.
        const day = THREE.MathUtils.smoothstep(sunY, -0.28, 0.25);
        const surface = THREE.MathUtils.lerp(SKY_FILL_NIGHT, SKY_FILL_DAY, day);
        hemi.intensity = THREE.MathUtils.lerp(surface, SKY_FILL_CAVE, undergroundBlend) * intensityMul;
        hemi.color.copy(skyNight).lerp(skyDay, day).lerp(caveTint, undergroundBlend);
        hemi.groundColor.copy(groundNight).lerp(groundDay, day).lerp(caveTint, undergroundBlend);
        // Keeper's glow: enough to read a cave wall a few metres away, fading to dark.
        const caveGlow = THREE.MathUtils.smoothstep(undergroundBlend, 0.25, 0.85);
        const nightGlow = (1 - THREE.MathUtils.smoothstep(sunY, -0.3, -0.05)) * 0.25;
        sharedUniforms.uPlayerGlow.value = Math.max(caveGlow * 1.4, nightGlow);
        frameProfiler.end('ambient-controller');
    });

    return <hemisphereLight ref={hemiRef} args={['#bcd6ff', '#8a7a5a', SKY_FILL_DAY]} />;
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
        uNightMix: { value: 0 },
        uSunDir: sharedUniforms.uSunDir,
    }), []);

    useFrame((state) => {
        frameProfiler.begin('sky-dome');
        if (meshRef.current) {
            meshRef.current.position.copy(state.camera.position);
            uniforms.uTopColor.value.copy(gradientRef.current.top);
            uniforms.uBottomColor.value.copy(gradientRef.current.bottom);
            uniforms.uTime.value = state.clock.getElapsedTime();
            const angle = calculateOrbitAngle(state.clock.getElapsedTime(), orbitConfig.speed, orbitConfig.offset);
            const sunHeight = Math.cos(angle);
            uniforms.uNightMix.value = 1.0 - THREE.MathUtils.smoothstep(sunHeight, -0.4, -0.1);
        }
        frameProfiler.end('sky-dome');
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
          uniform vec3 uSunDir;
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

            // Soft high clouds on a sky plane: slow drift, thin coverage,
            // sun-lit with a silver edge near the sun, dim at night.
            if (h > 0.0) {
              vec2 cuv = skyDir.xz / (h + 0.12) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
              float shape = fbm(vec3(cuv * 1.3, 0.0));
              float detail = fbm(vec3(cuv * 4.2 + 3.1, uTime * 0.01));
              float density = smoothstep(0.5, 0.78, shape * 0.8 + detail * 0.35);
              float cloudA = density * smoothstep(0.0, 0.28, h) * 0.85;
              vec3 sunD = normalize(uSunDir);
              float sunUp = clamp(sunD.y * 3.0 + 0.3, 0.0, 1.0);
              float toSun = max(dot(skyDir, sunD), 0.0);
              vec3 lit = mix(uBottomColor * 1.06, vec3(1.0, 0.98, 0.95), 0.55 * sunUp);
              vec3 shade = mix(uTopColor, uBottomColor, 0.5) * 0.82;
              vec3 cloudCol = mix(lit, shade, smoothstep(0.35, 1.0, density) * 0.55);
              cloudCol += vec3(1.0, 0.92, 0.8) * pow(toSun, 10.0) * (1.0 - density) * 0.6 * sunUp;
              cloudCol = mix(cloudCol, uTopColor * 1.6 + vec3(0.01, 0.012, 0.02), uNightMix);
              finalColor = mix(finalColor, cloudCol, cloudA);
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
        // Stable uniforms: an inline literal replaced them on every re-render.
        const glowUniforms = useMemo(() => ({
            uColor: { value: new THREE.Color() },
            uOpacity: { value: 0.25 },
            uTime: { value: 0 }
        }), []);

        const smoothSunPos = useRef(new THREE.Vector3());
        const lastCameraPos = useRef(new THREE.Vector3());
        const tmpDelta = useRef(new THREE.Vector3());
        const tmpLightOffset = useRef(new THREE.Vector3());
        const lastShadowUpdate = useRef(-Infinity);
        const lastShadowOrigin = useRef(new THREE.Vector2(Number.NaN, Number.NaN));
        const tmpVisualOffset = useRef(new THREE.Vector3());
        const tmpTargetSunPos = useRef(new THREE.Vector3());
        const tmpSunColor = useRef(new THREE.Color());
        const tmpSunMeshColor = useRef(new THREE.Color());
        const tmpGlowColor = useRef(new THREE.Color());

        useEffect(() => {
            lastCameraPos.current.copy(camera.position);
            // Follows the camera by accumulated deltas, so it must start at the
            // camera (starting at the origin offset the sun by the spawn position).
            smoothSunPos.current.copy(camera.position);
        }, [camera]);

        useFrame(({ clock }) => {
            // Read per frame (no React re-render while blends animate).
            const { undergroundBlend, underwaterBlend, skyVisibility } = useEnvironmentStore.getState();
            frameProfiler.begin('sun-follower');
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

                // Shadow map throttling: re-rendering every caster into the 2048^2 map
                // every frame was one of the largest GPU costs. The map and its matrix
                // stay consistent between updates, so skipping frames only adds a small
                // lag for moving casters. Update immediately when the snapped shadow
                // origin moves, otherwise at SHADOW_UPDATE_HZ.
                const shadow = lightRef.current.shadow;
                shadow.autoUpdate = false;
                const originMoved = lx !== lastShadowOrigin.current.x || lz !== lastShadowOrigin.current.y;
                if (originMoved || clock.elapsedTime - lastShadowUpdate.current >= 1 / SHADOW_UPDATE_HZ) {
                    shadow.needsUpdate = true;
                    lastShadowUpdate.current = clock.elapsedTime;
                    lastShadowOrigin.current.set(lx, lz);
                }
                lightRef.current.target = target;
                lightRef.current.updateMatrixWorld();
                target.updateMatrixWorld();

                if (sunDirection) {
                    sunDirection.copy(tmpLightOffset.current).normalize();
                }

                const sy = tmpLightOffset.current.y;
                const sunColor = getSunColor(sy, radius, tmpSunColor.current);
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
                        const sunMeshColor = tmpSunMeshColor.current.copy(sunColor);
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

                        // Sunset boost - narrower window and reduced intensity to avoid harsh orange halo
                        const sunsetBoost = normalizedHeight >= 0.0 ? THREE.MathUtils.clamp(1.0 - THREE.MathUtils.smoothstep(normalizedHeight, 0.08, 0.2), 0, 1) : 0.0;
                        const glowScale = THREE.MathUtils.lerp(3.5, 4.2, sunsetBoost); // Reduced max scale (was 5.0)
                        const baseGlowOpacity = (normalizedHeight < -0.15 ? 0.2 : 0.45);
                        const glowOpacityBase = THREE.MathUtils.lerp(baseGlowOpacity, 0.7, sunsetBoost); // Reduced max opacity (was 0.9)
                        const depthFade3 = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
                        const glowOpacity = glowOpacityBase * THREE.MathUtils.lerp(1.0, 0.25, depthFade3) * THREE.MathUtils.clamp(directVis, 0, 1);

                        glowMeshRef.current.scale.setScalar(glowScale);
                        const glowColor = getSunGlowColor(normalizedHeight, sunColor, tmpGlowColor.current);
                        glowMaterialRef.current.uniforms.uColor.value.copy(glowColor);
                        glowMaterialRef.current.uniforms.uOpacity.value = glowOpacity;
                        glowMaterialRef.current.uniforms.uTime.value = t;
                    }
                }
            }
            frameProfiler.end('sun-follower');
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
                    {/* ~2.3 deg across at 350 m (was ~4.9 deg). */}
                    <sphereGeometry args={[7, 32, 32]} />
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
                        uniforms={glowUniforms}
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
              float mask = 1.0 - smoothstep(0.46, 0.5, dist);
              if (mask <= 0.0) discard;
              float angle = ((abs(centered.y) + abs(centered.x)) < 1e-6 ? 0.0 : atan(centered.y, centered.x));
              float t = uTime;
              float coreInner = 1.0 / (dist * 45.0 + 0.4);
              coreInner = pow(coreInner, 3.2);
              float coreMid = 1.0 / (dist * 20.0 + 0.8);
              coreMid = pow(coreMid, 2.0);
              float core = coreInner * 1.2 + coreMid * 0.4;
              // Soft, wide glow only: no starburst spikes (they read as a cartoon sun).
              float halo = exp(-dist * 12.0) * 0.26;
              halo += exp(-dist * 7.5) * 0.08;
              float finalGlow = core + halo;
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
        const moonUniforms = useMemo(() => ({ uOpacity: { value: 1.0 } }), []);
        const tmpLightOffset = useRef(new THREE.Vector3());
        const tmpVisualOffset = useRef(new THREE.Vector3());

        useFrame(({ clock }) => {
            // Read per frame (no React re-render while blends animate).
            const { undergroundBlend, underwaterBlend, skyVisibility } = useEnvironmentStore.getState();
            frameProfiler.begin('moon-follower');
            if (!moonMeshRef.current || !lightRef.current) {
                frameProfiler.end('moon-follower');
                return;
            }
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
            // Smooth moon intensity transition instead of hard threshold pop-in
            // Moon fades in/out smoothly as it rises/sets between Y=-100 and Y=0
            const moonHeightFactor = THREE.MathUtils.smoothstep(lPy, -100, 0);
            lightRef.current.intensity = 0.2 * moonHeightFactor * moonDimming * directVis * intensityMul;
            if (undergroundBlend > 0.85) moonMeshRef.current.visible = false;
            frameProfiler.end('moon-follower');
        });

        return (
            <>
                <directionalLight ref={lightRef} color="#e0e8ff" />
                <primitive object={target} />
                <mesh ref={moonMeshRef}>
                    <sphereGeometry args={[12, 32, 32]} />
                    <shaderMaterial
                        transparent
                        uniforms={moonUniforms}
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
                float shadow = 1.0 - smoothstep(0.4, 0.5, dist);
                gl_FragColor = vec4(color, uOpacity * shadow);
              }
            `}
                    />
                </mesh>
            </>
        );
    };

export const AtmosphereController: React.FC<{
    orbitConfig: { radius: number; speed: number; offset: number };
    hazeAmount: number;
    brightness: number;
}> = ({ orbitConfig, hazeAmount, brightness }) => {
    const { scene } = useThree();
    const gradientRef = useRef({ top: new THREE.Color(), bottom: new THREE.Color() });
    const tunedTop = useRef(new THREE.Color());
    const tunedBottom = useRef(new THREE.Color());
    const hazeBlend = useRef(new THREE.Color());

    useFrame(({ clock }) => {
        frameProfiler.begin('atmosphere-controller');
        const t = clock.getElapsedTime();
        const angle = calculateOrbitAngle(t, orbitConfig.speed, orbitConfig.offset);
        const radius = orbitConfig.radius;
        const sunY = Math.cos(angle) * radius;
        getSkyGradient(sunY, radius, gradientRef.current.top, gradientRef.current.bottom);
        const clampedBrightness = Math.max(0, brightness ?? 1.0);
        const clampedHaze = THREE.MathUtils.clamp(hazeAmount ?? 0.0, 0.0, 1.0);

        tunedTop.current.copy(gradientRef.current.top).multiplyScalar(clampedBrightness);
        tunedBottom.current.copy(gradientRef.current.bottom).multiplyScalar(clampedBrightness);

        if (clampedHaze > 0) {
            hazeBlend.current.copy(tunedBottom.current).lerp(tunedTop.current, 0.25);
            tunedBottom.current.lerp(hazeBlend.current, clampedHaze);
        }

        gradientRef.current.top.copy(tunedTop.current);
        gradientRef.current.bottom.copy(tunedBottom.current);

        if (scene.fog) {
            scene.fog.color.copy(tunedBottom.current);
            // Underground the distance fades to darkness, not to the daylight horizon
            // (caves read as white voids otherwise).
            const { undergroundBlend } = useEnvironmentStore.getState();
            const cave = THREE.MathUtils.smoothstep(undergroundBlend, 0.15, 0.7);
            if (cave > 0) scene.fog.color.lerp(CAVE_FOG, cave);
        }
        if (scene.background instanceof THREE.Color) {
            scene.background.copy(tunedBottom.current);
        }
        frameProfiler.end('atmosphere-controller');
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
    hazeAmount: number;
    brightness: number;
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
                hazeAmount={props.hazeAmount}
                brightness={props.brightness}
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
