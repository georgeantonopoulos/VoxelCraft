import { create } from 'zustand';
import type { LogData, PieceKind } from '@/state/LogStore';
import { modesFor, type PlaceMode } from './logic/buildSnap';

/** How each kind of piece is set down (R or the wheel steps through its modes). */
interface BuildModeState {
  modes: Partial<Record<PieceKind, PlaceMode>>;
  modeOf: (kind: PieceKind | undefined) => PlaceMode;
  cycle: (kind: PieceKind | undefined) => PlaceMode;
}

export const useBuildModeStore = create<BuildModeState>((set, get) => ({
  modes: {},
  modeOf: (kind) => get().modes[kind ?? 'log'] ?? modesFor(kind)[0],
  cycle: (kind) => {
    const list = modesFor(kind);
    const next = list[(list.indexOf(get().modeOf(kind)) + 1) % list.length];
    set({ modes: { ...get().modes, [kind ?? 'log']: next } });
    return next;
  },
}));

/** What the player calls a piece. */
export const pieceName = (kind: PieceKind | undefined, notches?: string): string => {
  switch (kind) {
    case 'plank': return 'plank';
    case 'post': return 'post';
    case 'roof': return 'roof board';
    case 'door': return 'door';
    default: return notches && notches !== 'none' ? 'notched log' : 'log';
  }
};

/** What is in the arms, in words: "3 planks and a door". */
export const loadSummary = (pieces: (Pick<LogData, 'kind' | 'notches'> | undefined)[]): string => {
  const counts = new Map<string, number>();
  for (const p of pieces) if (p) { const n = pieceName(p.kind, p.notches); counts.set(n, (counts.get(n) ?? 0) + 1); }
  const parts = [...counts].map(([name, k]) => (k === 1 ? `a ${name}` : `${k} ${name}s`));
  return parts.length <= 1 ? (parts[0] ?? 'nothing') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

if (typeof window !== 'undefined') {
  (window as unknown as { __buildMode?: typeof useBuildModeStore }).__buildMode = useBuildModeStore;
}
