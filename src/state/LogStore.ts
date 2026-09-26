import { create } from 'zustand';

/**
 * Logs sawn from felled trees. Loose logs are physics bodies lying in the
 * world; a carried log is held by the player; placed logs are part of a
 * build (static). One source of truth for all three, so carrying and
 * building never duplicate or lose a log.
 */
export type LogState = 'loose' | 'carried' | 'placed';

export interface LogData {
  id: string;
  position: [number, number, number];
  /** Orientation as a quaternion (x, y, z, w); the log's long axis is local +Y. */
  rotation: [number, number, number, number];
  length: number;
  radius: number;
  /** Bark colour of the tree it came from. */
  bark: string;
  state: LogState;
}

interface LogStoreState {
  logs: Record<string, LogData>;
  addLogs: (logs: LogData[]) => void;
  updateLog: (id: string, patch: Partial<LogData>) => void;
  removeLog: (id: string) => void;
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
  setCarried: (id) => set({ carriedId: id }),
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __logStore?: typeof useLogStore }).__logStore = useLogStore;
}
