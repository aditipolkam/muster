import { create } from 'zustand';
import { Fix } from '../domain/location/fix';
import { PermissionState } from '../domain/location/permission';

export type LocationStoreState = {
  permission: PermissionState;
  fix: Fix | null;
  headingDeg: number | null;
  /** Date.now() when the watch started; null if not watching. */
  watchingSince: number | null;
  lastError: string | null;
  set: (p: Partial<Omit<LocationStoreState, 'set'>>) => void;
};

export const useLocationStore = create<LocationStoreState>(set => ({
  permission: 'undetermined',
  fix: null,
  headingDeg: null,
  watchingSince: null,
  lastError: null,
  set: p => set(p),
}));
