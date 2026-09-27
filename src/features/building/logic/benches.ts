import { PLANK_THICKNESS, type LogData } from '@/state/LogStore';
import { frameOf, isFlatFace, isUpright } from './pieceFrame';

/**
 * A workbench is three placed planks set like a table: one lying flat on top
 * of two standing planks spaced apart under it. Benches are not stored; they
 * are read from the placed pieces, so building or taking one apart is just
 * placing or lifting planks.
 */
export interface Bench {
  /** The top plank's id (also the bench's id). */
  id: string;
  legIds: [string, string];
  /** Top surface centre. */
  top: [number, number, number];
}

/** How close a leg's top must be to the underside of the top plank (m). */
const SEAT = 0.12;

export function findBenches(logs: Iterable<LogData>): Bench[] {
  const placed = [...logs].filter((l) => l.state === 'placed');
  const boards = placed.filter((l) => l.kind === 'plank');
  const legs = boards.filter((l) => isUpright(frameOf(l)));
  const benches: Bench[] = [];
  for (const top of boards) {
    const f = frameOf(top);
    if (!isFlatFace(f)) continue;
    const underside = f.center.y - PLANK_THICKNESS / 2;
    const under: { id: string; along: number }[] = [];
    for (const leg of legs) {
      if (leg.id === top.id) continue;
      const lf = frameOf(leg);
      const legTop = lf.center.y + leg.length / 2;
      if (Math.abs(legTop - underside) > SEAT) continue;
      const d = lf.center.clone().sub(f.center).setY(0);
      const along = d.dot(f.axis);
      const across = d.dot(f.width);
      if (Math.abs(along) > top.length / 2 + 0.05 || Math.abs(across) > top.radius + 0.12) continue;
      under.push({ id: leg.id, along });
    }
    if (under.length < 2) continue;
    under.sort((a, b) => a.along - b.along);
    const a = under[0], b = under[under.length - 1];
    if (b.along - a.along < top.length * 0.35) continue;
    benches.push({ id: top.id, legIds: [a.id, b.id], top: [f.center.x, f.center.y + PLANK_THICKNESS / 2, f.center.z] });
  }
  return benches;
}

/** The piece waiting on a bench to be shaped, if any. */
export const workpieceOn = (benchId: string, logs: Iterable<LogData>): LogData | undefined =>
  [...logs].find((l) => l.onBench === benchId && l.state === 'placed');
