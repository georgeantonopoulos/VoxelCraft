import * as THREE from 'three';
import type { LogData } from '@/state/LogStore';

/**
 * Where a building piece points. Every piece has its long axis on local +Y;
 * boards have their width on local X and their face normal on local Z.
 */
export const UP = new THREE.Vector3(0, 1, 0);

export interface PieceFrame {
  center: THREE.Vector3;
  q: THREE.Quaternion;
  /** Long axis (local +Y). */
  axis: THREE.Vector3;
  /** Width axis (local +X). */
  width: THREE.Vector3;
  /** Face normal (local +Z). */
  normal: THREE.Vector3;
}

export const frameOf = (l: Pick<LogData, 'position' | 'rotation'>): PieceFrame => {
  const q = new THREE.Quaternion(l.rotation[0], l.rotation[1], l.rotation[2], l.rotation[3]);
  return {
    center: new THREE.Vector3(l.position[0], l.position[1], l.position[2]),
    q,
    axis: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    width: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    normal: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
  };
};

/** Long axis within ~37 degrees of vertical: a post or a standing board. */
export const isUpright = (f: PieceFrame): boolean => Math.abs(f.axis.y) > 0.8;

/** A board lying face up or down (floor, bench top). */
export const isFlatFace = (f: PieceFrame): boolean => Math.abs(f.normal.y) > 0.9;

/**
 * Rotation for a piece whose long axis is `axis` and whose width runs along
 * `width` (both unit, perpendicular). The face normal is their cross product.
 */
export const basisQuat = (width: THREE.Vector3, axis: THREE.Vector3): THREE.Quaternion => {
  const normal = new THREE.Vector3().crossVectors(width, axis).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(width, axis, normal));
};

/** A piece lying along horizontal `dir` with its face up (logs keep notches top and bottom). */
export const lyingQuat = (dir: THREE.Vector3): THREE.Quaternion => {
  const axis = dir.clone().setY(0).normalize();
  const width = new THREE.Vector3().crossVectors(axis, UP).normalize();
  return basisQuat(width, axis);
};

/** A piece standing upright with its width along horizontal `widthDir`. */
export const uprightQuat = (widthDir: THREE.Vector3): THREE.Quaternion => {
  const width = widthDir.clone().setY(0).normalize();
  return basisQuat(width, UP.clone());
};

/** Horizontal heading (radians) of a direction. */
export const yawOf = (v: THREE.Vector3): number => Math.atan2(v.x, v.z);

/** Horizontal unit direction for a heading. */
export const dirOfYaw = (yaw: number): THREE.Vector3 => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

/**
 * The heading a piece gives its build: the direction of its long axis if it
 * lies down, otherwise its width.
 */
export const buildYawOf = (f: PieceFrame): number | null => {
  const d = isUpright(f) ? f.width.clone() : f.axis.clone();
  d.y = 0;
  if (d.lengthSq() < 1e-4) return null;
  return yawOf(d);
};

/** Snap `yaw` to the nearest quarter turn of `frameYaw`. */
export const snapYaw = (yaw: number, frameYaw: number): number => {
  const q = Math.PI / 2;
  return frameYaw + Math.round((yaw - frameYaw) / q) * q;
};
