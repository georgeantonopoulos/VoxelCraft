import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER } from '@core/graphics/GroundItemShaders';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { PLANK_THICKNESS, ROOF_THICKNESS, DOOR_THICKNESS, type LogData, type NotchFormation } from '@/state/LogStore';
import { buildNotchedLogGeometry } from '../logic/pieceGeometry';
import { COPPER_COLOR } from '../logic/copperVeins';

/**
 * How every building piece looks: sawn logs (with saddle notches when hewn
 * at the bench), split planks, squared posts, roof boards and ledged doors.
 * Wood surfaces use the stick shader, so logs, boards and sticks read as the
 * same wood. Used by placed/loose pieces, the carried piece, the carpentry
 * bench preview and the shader warm-up.
 */

/** Fresh-cut wood (board faces, hewn timber). */
export const SAWN_WOOD = '#b89a70';
const HEWN_WOOD = '#a4835a';
/** Axe-cut faces in the notches: paler than bark, duller than a sawn board. */
const NOTCH_WOOD = '#9c7c55';
const ROOF_WOOD = '#8d7656';
const DOOR_WOOD = '#a88a62';

let ringTexture: THREE.CanvasTexture | null = null;
export const getRingTexture = (): THREE.CanvasTexture => {
  if (ringTexture) return ringTexture;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  // Pale fresh-cut heartwood, darker sapwood rim, fine growth rings.
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, '#b08a5a');
  grad.addColorStop(0.75, '#d8bb8a');
  grad.addColorStop(0.9, '#c9a574');
  grad.addColorStop(1, '#5b4a38');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(110, 80, 45, 0.35)';
  for (let r = 4; r < n / 2 - 4; r += 3 + Math.random() * 3) {
    g.lineWidth = 0.6 + Math.random() * 0.8;
    g.beginPath();
    g.ellipse(n / 2 + (Math.random() - 0.5), n / 2 + (Math.random() - 0.5), r, r * (0.96 + Math.random() * 0.06), 0, 0, Math.PI * 2);
    g.stroke();
  }
  // A radial check crack.
  g.strokeStyle = 'rgba(60, 40, 25, 0.5)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(n / 2, n / 2);
  g.lineTo(n * 0.9, n * 0.62);
  g.stroke();
  ringTexture = new THREE.CanvasTexture(c);
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  return ringTexture;
};

/** Stick-shader wood. `spin` turns the grain about the length (round pieces only). */
const Wood: React.FC<{ color: string; length: number; seed: number; spin?: boolean; roughness?: number; attach?: string }> = ({ color, length, seed, spin = false, roughness = 0.92, attach }) => {
  const uniforms = useMemo(() => ({
    uInstancing: { value: false },
    uSeed: { value: seed },
    uHeight: { value: length },
    uSpin: { value: spin ? 1 : 0 },
    uNoiseTexture: { value: getNoiseTexture() },
    uColor: { value: new THREE.Color(color) },
  }), [seed, length, color, spin]);
  return (
    <CustomShaderMaterial
      attach={attach}
      baseMaterial={THREE.MeshStandardMaterial}
      vertexShader={STICK_SHADER.vertex}
      fragmentShader={STICK_SHADER.fragment}
      uniforms={uniforms}
      color={color}
      roughness={roughness}
      metalness={0}
    />
  );
};

const useDisposable = <T extends { dispose: () => void }>(make: () => T, deps: React.DependencyList): T => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const v = useMemo(make, deps);
  useEffect(() => () => v.dispose(), [v]);
  return v;
};

const useCapMaterial = () => useDisposable(() => new THREE.MeshStandardMaterial({ map: getRingTexture(), roughness: 0.9 }), []);

export const LogMesh: React.FC<{ length: number; radius: number; bark: string; seed?: number; notches?: NotchFormation }> = ({ length, radius, bark, seed = 1, notches = 'none' }) => {
  const side = useDisposable(() => buildNotchedLogGeometry(length, radius, notches), [length, radius, notches]);
  const cap = useDisposable(() => new THREE.CircleGeometry(radius * 0.99, 18), [radius]);
  const capMaterial = useCapMaterial();
  const notched = notches !== 'none';
  return (
    <group>
      <mesh geometry={side} castShadow receiveShadow>
        {notched ? (
          <>
            <Wood attach="material-0" color={bark} length={length} seed={seed} roughness={0.95} />
            <meshStandardMaterial attach="material-1" color={NOTCH_WOOD} roughness={0.95} />
          </>
        ) : (
          <Wood color={bark} length={length} seed={seed} spin roughness={0.95} />
        )}
      </mesh>
      <mesh geometry={cap} material={capMaterial} position={[0, length / 2, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <mesh geometry={cap} material={capMaterial} position={[0, -length / 2, 0]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
};

/** A split plank: a pale board, grain along its length, a strip of bark on one edge. */
export const PlankMesh: React.FC<{ length: number; halfWidth: number; bark: string; seed?: number }> = ({ length, halfWidth, bark, seed = 1 }) => {
  const board = useDisposable(() => new THREE.BoxGeometry(halfWidth * 2, length, PLANK_THICKNESS, 2, 6, 1), [length, halfWidth]);
  const edge = useDisposable(() => new THREE.BoxGeometry(0.012, length * 0.98, PLANK_THICKNESS * 0.9), [length]);
  const barkMaterial = useDisposable(() => new THREE.MeshStandardMaterial({ color: bark, roughness: 0.95 }), [bark]);
  return (
    <group>
      <mesh geometry={board} castShadow receiveShadow>
        <Wood color={SAWN_WOOD} length={length} seed={seed} roughness={0.9} />
      </mesh>
      <mesh geometry={edge} material={barkMaterial} position={[halfWidth + 0.004, 0, 0]} castShadow />
    </group>
  );
};

/** Squared timber with a tenon on top. */
export const PostMesh: React.FC<{ length: number; halfSide: number; seed?: number }> = ({ length, halfSide, seed = 1 }) => {
  const body = useDisposable(() => new THREE.BoxGeometry(halfSide * 2, length, halfSide * 2, 1, 6, 1), [length, halfSide]);
  const tenon = useDisposable(() => new THREE.BoxGeometry(halfSide * 0.9, 0.09, halfSide * 0.9), [halfSide]);
  return (
    <group>
      <mesh geometry={body} castShadow receiveShadow>
        <Wood color={HEWN_WOOD} length={length} seed={seed} />
      </mesh>
      <mesh geometry={tenon} position={[0, length / 2 + 0.045, 0]} castShadow>
        <meshStandardMaterial color={SAWN_WOOD} roughness={0.9} />
      </mesh>
    </group>
  );
};

/** A roof board: weathered face, a thin lap along one edge for the next board to overlap. */
export const RoofBoardMesh: React.FC<{ length: number; halfWidth: number; seed?: number }> = ({ length, halfWidth, seed = 1 }) => {
  const board = useDisposable(() => new THREE.BoxGeometry(halfWidth * 2, length, ROOF_THICKNESS, 2, 6, 1), [length, halfWidth]);
  const lap = useDisposable(() => new THREE.BoxGeometry(halfWidth * 0.35, length, ROOF_THICKNESS * 0.55), [length, halfWidth]);
  return (
    <group>
      <mesh geometry={board} castShadow receiveShadow>
        <Wood color={ROOF_WOOD} length={length} seed={seed} />
      </mesh>
      <mesh geometry={lap} position={[halfWidth * 0.95, 0, ROOF_THICKNESS * 0.5]} castShadow receiveShadow>
        <Wood color={ROOF_WOOD} length={length} seed={seed + 3} />
      </mesh>
    </group>
  );
};

/**
 * A ledged and braced door: four upright boards, two ledges and a diagonal
 * brace on the inside (-Z), copper strap hinges on the outside with their
 * knuckles on the hinge edge (local -X), a wooden pull on the latch side.
 */
export const DoorMesh: React.FC<{ height: number; halfWidth: number; seed?: number }> = ({ height, halfWidth, seed = 1 }) => {
  const w = halfWidth * 2;
  const boardW = w / 4;
  const board = useDisposable(() => new THREE.BoxGeometry(boardW - 0.006, height, DOOR_THICKNESS, 1, 4, 1), [boardW, height]);
  const ledge = useDisposable(() => new THREE.BoxGeometry(w * 0.9, 0.12, 0.035), [w]);
  const braceLen = Math.hypot(w * 0.78, height * 0.56);
  const brace = useDisposable(() => new THREE.BoxGeometry(0.1, braceLen, 0.03), [braceLen]);
  const strap = useDisposable(() => new THREE.BoxGeometry(w * 0.58, 0.045, 0.01), [w]);
  const knuckle = useDisposable(() => new THREE.CylinderGeometry(0.02, 0.02, 0.11, 10), []);
  const pull = useDisposable(() => new THREE.BoxGeometry(0.035, 0.2, 0.04), []);
  const copper = useDisposable(() => new THREE.MeshStandardMaterial({ color: COPPER_COLOR, roughness: 0.45, metalness: 0 }), []);
  const ledgeY = height * 0.3;
  const braceAngle = Math.atan2(w * 0.78, height * 0.56);
  return (
    <group>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} geometry={board} position={[-halfWidth + boardW * (k + 0.5), 0, 0]} castShadow receiveShadow>
          <Wood color={DOOR_WOOD} length={height} seed={seed + k} />
        </mesh>
      ))}
      {[1, -1].map((s) => (
        <mesh key={s} geometry={ledge} position={[0, s * ledgeY, -DOOR_THICKNESS / 2 - 0.0175]} castShadow>
          <Wood color={HEWN_WOOD} length={0.12} seed={seed + 7} />
        </mesh>
      ))}
      <mesh geometry={brace} position={[0, 0, -DOOR_THICKNESS / 2 - 0.015]} rotation={[0, 0, braceAngle]} castShadow>
        <Wood color={HEWN_WOOD} length={braceLen} seed={seed + 9} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh geometry={strap} material={copper} position={[-halfWidth + w * 0.29, s * ledgeY, DOOR_THICKNESS / 2 + 0.005]} />
          <mesh geometry={knuckle} material={copper} position={[-halfWidth - 0.012, s * ledgeY, 0]} />
        </group>
      ))}
      <mesh geometry={pull} position={[halfWidth - 0.1, 0, DOOR_THICKNESS / 2 + 0.03]}>
        <meshStandardMaterial color={HEWN_WOOD} roughness={0.85} />
      </mesh>
    </group>
  );
};

/** Any building piece, drawn in its own frame (long axis +Y). */
export const PieceMesh: React.FC<{ piece: Pick<LogData, 'kind' | 'length' | 'radius' | 'bark' | 'notches'>; seed?: number }> = ({ piece, seed = 1 }) => {
  switch (piece.kind) {
    case 'plank': return <PlankMesh length={piece.length} halfWidth={piece.radius} bark={piece.bark} seed={seed} />;
    case 'post': return <PostMesh length={piece.length} halfSide={piece.radius} seed={seed} />;
    case 'roof': return <RoofBoardMesh length={piece.length} halfWidth={piece.radius} seed={seed} />;
    case 'door': return <DoorMesh height={piece.length} halfWidth={piece.radius} seed={seed} />;
    default: return <LogMesh length={piece.length} radius={piece.radius} bark={piece.bark} seed={seed} notches={piece.notches ?? 'none'} />;
  }
};
