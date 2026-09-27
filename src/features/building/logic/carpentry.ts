import type { LogData, NotchFormation, PieceKind } from '@/state/LogStore';
import type { Materials } from '@/state/MaterialsStore';

/**
 * What can be shaped at the workbench (pure rules; CarpentryInterface shows
 * them). A cut takes the workpiece on the bench and turns it into new pieces
 * (and sometimes pouch materials). Cutting across needs a saw; hewing,
 * notching and splitting need an axe; hinges need copper pins.
 */

export interface CarpentryTools { saw: boolean; axe: boolean }

export interface CutChoice<T extends string = string> { id: T; label: string }

export type CutId = 'wall' | 'post' | 'tall' | 'short' | 'roof' | 'door' | 'cut' | 'hinges' | 'apart';

export interface Cut {
  id: CutId;
  title: string;
  blurb: string;
  needs: { saw?: boolean; axe?: boolean; copper?: number; hinges?: number; minLength?: number };
  /** Notch formations to choose from (logs). */
  formations?: CutChoice<NotchFormation>[];
  /** How many equal lengths to cut it into. */
  lengths?: CutChoice<'1' | '2' | '3'>[];
}

export interface CutOptions { formation?: NotchFormation; pieces?: number }

/** A new piece, before it is set down somewhere. */
export type PieceTemplate = Pick<LogData, 'kind' | 'length' | 'radius' | 'bark' | 'notches'>;

export interface CutResult {
  pieces: PieceTemplate[];
  /** Pouch changes (negative = spent). */
  materials: Partial<Materials>;
}

/** Door size (m): tall and wide enough to walk through (player capsule 1.6 x 0.8). */
export const DOOR_HEIGHT = 1.85;
export const DOOR_HALF_WIDTH = 0.46;
/** Shortest piece worth cutting. */
const MIN_PIECE = 0.45;
/** Saw kerf between cut pieces. */
const KERF = 0.02;

const FORMATIONS: CutChoice<NotchFormation>[] = [
  { id: 'both', label: 'Notched both ends' },
  { id: 'one', label: 'Notched one end' },
  { id: 'none', label: 'No notches' },
];

const lengthChoices = (length: number, max = 3): CutChoice<'1' | '2' | '3'>[] => {
  const all: CutChoice<'1' | '2' | '3'>[] = [
    { id: '1', label: `Whole · ${length.toFixed(1)} m` },
    { id: '2', label: `Halves · 2 × ${(length / 2 - KERF).toFixed(1)} m` },
    { id: '3', label: `Thirds · 3 × ${(length / 3 - KERF).toFixed(1)} m` },
  ];
  return all.filter((c) => Number(c.id) <= max && (c.id === '1' || length / Number(c.id) - KERF >= MIN_PIECE));
};

/** Boards split from a log of this radius: how many and how wide. */
export const boardsFromLog = (radius: number): { count: number; halfWidth: number } => ({
  count: radius >= 0.24 ? 4 : 3,
  halfWidth: Math.min(0.2, radius * 0.6),
});

export function cutsFor(piece: LogData): Cut[] {
  const kind: PieceKind = piece.kind ?? 'log';
  const L = piece.length;
  switch (kind) {
    case 'log': {
      const boards = boardsFromLog(piece.radius);
      return [
        {
          id: 'wall', title: 'Wall logs',
          blurb: 'Hewn with saddle notches, so the logs of two walls lock into each other at the corners. Short lengths frame a doorway.',
          needs: { axe: true }, formations: FORMATIONS, lengths: lengthChoices(L),
        },
        {
          id: 'post', title: 'Posts',
          blurb: 'Squared timber with a tenon on top. Stand them at the corners of a frame and lay logs across them.',
          needs: { axe: true }, lengths: lengthChoices(L, 2),
        },
        {
          id: 'tall', title: 'Tall planks',
          blurb: `Split along the grain into ${boards.count} long boards. Stood side by side they make a wall; laid flat, a floor.`,
          needs: { axe: true },
        },
        {
          id: 'short', title: 'Short planks',
          blurb: `${boards.count * 2} boards half the log's length, for floors, shelves and benches.`,
          needs: { axe: true, saw: true, minLength: MIN_PIECE * 2 },
        },
        {
          id: 'roof', title: 'Roof boards',
          blurb: `${boards.count} boards bevelled with a lap along one edge, so rain runs off. They lean from a wall top up to the ridge.`,
          needs: { axe: true },
        },
        {
          id: 'door', title: 'Door',
          blurb: 'Boards on two ledges and a brace, hung on a pair of hinges. Stand it in a doorway; right click swings it.',
          needs: { axe: true, saw: true, hinges: 1, minLength: DOOR_HEIGHT },
        },
      ];
    }
    case 'plank':
      return [
        { id: 'cut', title: 'Short planks', blurb: 'Sawn across into equal lengths.', needs: { saw: true }, lengths: lengthChoices(L).filter((c) => c.id !== '1') },
        { id: 'roof', title: 'Roof board', blurb: 'Bevelled with a lap along one edge, so the next board overlaps it.', needs: { axe: true } },
        {
          id: 'hinges', title: 'Hinges',
          blurb: 'Two strap leaves carved from the board, pinned with hammered copper. A door hangs on one pair.',
          needs: { axe: true, copper: 2 },
        },
      ];
    case 'roof':
    case 'post':
      return [{ id: 'cut', title: 'Cut shorter', blurb: 'Sawn across into equal lengths.', needs: { saw: true }, lengths: lengthChoices(L).filter((c) => c.id !== '1') }];
    case 'door':
      return [{ id: 'apart', title: 'Take apart', blurb: 'Knock out the pins: three planks and the hinges back.', needs: {} }];
  }
}

/** The saw is needed for lengths cut across, even when the cut itself only hews. */
export const needsSawFor = (cut: Cut, opts: CutOptions): boolean => !!cut.needs.saw || (opts.pieces ?? 1) > 1;

/** Why a cut cannot be made right now (null if it can). */
export function missingFor(cut: Cut, piece: LogData, tools: CarpentryTools, materials: Materials, opts: CutOptions = {}): string | null {
  const n = cut.needs;
  if (n.minLength && piece.length < n.minLength - 1e-6) return `Needs a piece at least ${n.minLength.toFixed(1)} m long`;
  if (cut.lengths && cut.lengths.length === 0) return 'Too short to cut';
  if (n.axe && !tools.axe) return 'Needs a flint axe';
  if (needsSawFor(cut, opts) && !tools.saw) return 'Needs a flint saw';
  if (n.copper && materials.copper < n.copper) return `Needs ${n.copper} copper nuggets (dig for veins in the rock)`;
  if (n.hinges && materials.hinges < n.hinges) return 'Needs a pair of hinges (carve them from a plank)';
  return null;
}

export function applyCut(piece: LogData, cut: Cut, opts: CutOptions = {}): CutResult {
  const bark = piece.bark;
  const n = Math.max(1, opts.pieces ?? 1);
  const each = n > 1 ? piece.length / n - KERF : piece.length;
  const repeat = (t: PieceTemplate, k: number): PieceTemplate[] => Array.from({ length: k }, () => ({ ...t }));
  switch (cut.id) {
    case 'wall':
      return { pieces: repeat({ kind: 'log', length: each, radius: piece.radius, bark, notches: opts.formation ?? 'both' }, n), materials: {} };
    case 'post':
      return { pieces: repeat({ kind: 'post', length: each, radius: piece.radius * 0.72, bark }, n), materials: {} };
    case 'tall': {
      const b = boardsFromLog(piece.radius);
      return { pieces: repeat({ kind: 'plank', length: piece.length, radius: b.halfWidth, bark }, b.count), materials: {} };
    }
    case 'short': {
      const b = boardsFromLog(piece.radius);
      return { pieces: repeat({ kind: 'plank', length: piece.length / 2 - KERF, radius: b.halfWidth, bark }, b.count * 2), materials: {} };
    }
    case 'roof': {
      if ((piece.kind ?? 'log') === 'log') {
        const b = boardsFromLog(piece.radius);
        return { pieces: repeat({ kind: 'roof', length: piece.length, radius: b.halfWidth, bark }, b.count), materials: {} };
      }
      return { pieces: [{ kind: 'roof', length: piece.length, radius: piece.radius, bark }], materials: {} };
    }
    case 'door':
      return { pieces: [{ kind: 'door', length: DOOR_HEIGHT, radius: DOOR_HALF_WIDTH, bark }], materials: { hinges: -1 } };
    case 'cut':
      return { pieces: repeat({ kind: piece.kind, length: each, radius: piece.radius, bark }, n), materials: {} };
    case 'hinges':
      return { pieces: [], materials: { copper: -2, hinges: 1 } };
    case 'apart':
      return { pieces: repeat({ kind: 'plank', length: piece.length, radius: piece.radius / 3, bark }, 3), materials: { hinges: 1 } };
  }
}
