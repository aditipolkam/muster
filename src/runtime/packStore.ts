import { create } from 'zustand';

export type PackProgress = {
  phase: 'downloading' | 'verifying';
  receivedBytes: number;
  totalBytes: number;
  /** smoothed bytes/s for the "time left" hint */
  rate: number;
  at: number;
};

type PackStore = {
  progress: Record<string, PackProgress>;
  report: (id: string, p: Omit<PackProgress, 'rate' | 'at'>, now: number) => void;
  clear: (id: string) => void;
};

export const usePackStore = create<PackStore>(set => ({
  progress: {},
  report: (id, p, now) =>
    set(s => {
      const prev = s.progress[id];
      let rate = prev?.rate ?? 0;
      if (prev && p.phase === 'downloading' && now > prev.at) {
        const inst = ((p.receivedBytes - prev.receivedBytes) / (now - prev.at)) * 1000;
        rate = prev.rate === 0 ? inst : prev.rate * 0.8 + inst * 0.2;
      }
      return { progress: { ...s.progress, [id]: { ...p, rate, at: now } } };
    }),
  clear: id =>
    set(s => {
      const next = { ...s.progress };
      delete next[id];
      return { progress: next };
    }),
}));
