import { create } from 'zustand';

/**
 * Logs sawn from felled trees, and every building piece shaped from them at
 * a workbench. Loose pieces are physics bodies lying in the world; a carried
 * piece is held by the player; placed pieces are part of a build (static).
 * One source of truth for all three, so carrying and building never
 * duplicate or lose a piece.
 */
export type LogState = 'loose' | 'carried' | 'placed';

/**
 * - log: a round log (raw, or hewn with saddle notches for log-cabin corners);
 * - plank: a split board (radius is half its width);
 * - post: a squared timber with a tenon on top (radius is half its side);
 * - roof: a bevelled roof board with a lap along one edge (radius is half its width);
 * - door: a ledged board door on copper-pinned hinges (length is its height,
 *   radius half its width).
 */
export type PieceKind = 'log' | 'plank' | 'post' | 'roof' | 'door';

/** Saddle notches cut into a log: none, one end (local +Y), or both ends. */
export type NotchFormation = 'none' | 'one' | 'both';

export interface LogData {
  id: string;
  position: [number, number, number];
  /** Orientation as a quaternion (x, y, z, w); the piece's long axis is local +Y. */
  rotation: [number, number, number, number];
  length: number;
  radius: number;
  /** Bark colour of the tree it came from. */
  bark: string;
  state: LogState;
  kind?: PieceKind;
  /** Logs only: saddle notches near the ends (they interlock at corners). */
  notches?: NotchFormation;
  /** Doors only: swung open. */
  open?: boolean;
  /** Doors only: which way it swings (+1 or -1 about its hinge). */
  swing?: 1 | -1;
  /** Set on a workbench (the bench's top plank id) waiting to be shaped. */
  onBench?: string;
}

/** Thickness of a split plank (m). */
export const PLANK_THICKNESS = 0.06;
/** Thickness of a roof board (m). */
export const ROOF_THICKNESS = 0.05;
/** Thickness of a door leaf (m). */
export const DOOR_THICKNESS = 0.07;

/** Half the thickness of a flat piece, or the radius of a round/square one. */
export const pieceHalfDepth = (l: Pick<LogData, 'kind' | 'radius'>): number => {
  switch (l.kind) {
    case 'plank': return PLANK_THICKNESS / 2;
    case 'roof': return ROOF_THICKNESS / 2;
    case 'door': return DOOR_THICKNESS / 2;
    default: return l.radius;
  }
};

/** Flat pieces (boards) versus round or square timbers. */
export const isBoard = (kind: PieceKind | undefined): boolean => kind === 'plank' || kind === 'roof' || kind === 'door';

/** The piece the player placed most recently (for noticing a bench they just finished). */
export const lastPlaced = { id: '', at: 0 };

interface LogStoreState {
  logs: Record<string, LogData>;
  addLogs: (logs: LogData[]) => void;
  updateLog: (id: string, patch: Partial<LogData>) => void;
  removeLog: (id: string) => void;
  removeLogs: (ids: string[]) => void;
  /** The log the player is holding, if any. */
  carriedId: string | null;
  setCarried: (id: string | null) => void;
}

export const useLogStore = create<LogStoreState>((set, get) => ({
  logs: {},
  carriedId: null,
  addLogs: (logs) => set({ logs: { ...get().logs, ...Object.fromEntries(logs.map((l) => [l.id, l])) } }),
  updateLog: (id, patch) => {
    const cur = get().logs[id];
    if (!cur) return;
    set({ logs: { ...get().logs, [id]: { ...cur, ...patch } } });
  },
  removeLog: (id) => {
    const { [id]: _gone, ...rest } = get().logs;
    set({ logs: rest, carriedId: get().carriedId === id ? null : get().carriedId });
  },
  removeLogs: (ids) => {
    const gone = new Set(ids);
    const rest = Object.fromEntries(Object.entries(get().logs).filter(([id]) => !gone.has(id)));
    set({ logs: rest, carriedId: get().carriedId && gone.has(get().carriedId!) ? null : get().carriedId });
  },
  setCarried: (id) => set({ carriedId: id }),
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __logStore?: typeof useLogStore }).__logStore = useLogStore;
}
