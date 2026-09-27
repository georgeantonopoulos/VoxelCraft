import * as THREE from 'three';
import type { NotchFormation } from '@/state/LogStore';

/**
 * A round log with saddle notches: scoops across the top and bottom near
 * the ends where the crossing log of the other wall sits. Lying pieces have
 * local +Z up (pieceFrame.lyingQuat), so the scoops face up and down.
 * Each scoop is a cylinder of the log's radius across the log, half a
 * radius deep; together with the crossing log's own scoop they close the
 * half-log overlap of an interlocked corner. Notched geometry has two draw
 * groups: bark (material 0) and the scoops' cut wood (material 1).
 */
export const NOTCH_DEPTH = 0.5;

export function notchCentres(length: number, radius: number, notches: NotchFormation): number[] {
  const inset = radius + 0.05;
  if (notches === 'both') return [length / 2 - inset, -(length / 2 - inset)];
  if (notches === 'one') return [length / 2 - inset];
  return [];
}

export function buildNotchedLogGeometry(length: number, radius: number, notches: NotchFormation): THREE.BufferGeometry {
  const centres = notchCentres(length, radius, notches);
  // Plain logs stay light; notched ones get a finer mesh so the scoop edges are smooth.
  if (!centres.length) return new THREE.CylinderGeometry(radius * 0.97, radius, length, 20, 4, true);
  const rows = Math.max(8, Math.ceil(length / 0.02));
  const g = new THREE.CylinderGeometry(radius * 0.97, radius, length, 36, rows, true);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const rn = radius;
  const cz = radius + rn - NOTCH_DEPTH * radius;
  const cut = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    let z = pos.getZ(i);
    for (const ny of centres) {
      for (const side of [1, -1]) {
        const c = side * cz;
        const dy = y - ny, dz = z - c;
        const d = Math.hypot(dy, dz);
        if (d < rn && d > 1e-6) {
          y = ny + (dy / d) * rn;
          z = c + (dz / d) * rn;
          // The scoop's surface faces its own axis (out of the wood).
          nor.setXYZ(i, 0, -dy / d, -dz / d);
          cut[i] = 1;
        }
      }
    }
    pos.setY(i, y);
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  // Two draw groups: bark (0), and the fresh-cut faces of the scoops (1).
  const index = g.getIndex()!;
  const bark: number[] = [], scoop: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    (cut[a] && cut[b] && cut[c] ? scoop : bark).push(a, b, c);
  }
  g.setIndex([...bark, ...scoop]);
  g.clearGroups();
  g.addGroup(0, bark.length, 0);
  g.addGroup(bark.length, scoop.length, 1);
  g.computeBoundingSphere();
  return g;
}
