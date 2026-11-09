import { create } from 'zustand';

/** What is being navigated to. UI state only: nothing here is stored or sent. */
export type NavSessionTarget = {
  name: string;
  lat: number;
  lon: number;
  kind?: 'meeting' | 'marker' | 'checkpoint' | 'pin';
  /** For a meeting point: `<groupId>:<pointId>`, so the compass can re-select it. */
  key?: string;
};

type NavSession = {
  /** Set while straight-line navigation is running; the tab bar hides while it is. */
  target: NavSessionTarget | null;
  /** Full-screen flows on the map (placing a pin) also hide the tab bar. */
  picking: boolean;
  start: (t: NavSessionTarget) => void;
  end: () => void;
  setPicking: (on: boolean) => void;
};

/**
 * One navigation session shared by the Map and Compass views, so the Map | Compass toggle
 * switches views without losing the destination.
 */
export const useNavSession = create<NavSession>(set => ({
  target: null,
  picking: false,
  start: target => set({ target }),
  end: () => set({ target: null }),
  setPicking: picking => set({ picking }),
}));
