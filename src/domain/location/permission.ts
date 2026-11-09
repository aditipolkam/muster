export type PermissionState =
  | 'undetermined'
  | 'denied' // can still be asked
  | 'blocked' // denied and the OS will not show the prompt again
  | 'approximate' // iOS reduced accuracy / Android coarse only
  | 'granted'
  | 'services_off';

export type RawPermission = {
  status: 'undetermined' | 'denied' | 'granted';
  canAskAgain: boolean;
  /** true when only coarse/approximate location was granted */
  coarseOnly: boolean;
  servicesEnabled: boolean;
};

export function derivePermissionState(raw: RawPermission): PermissionState {
  if (raw.status === 'granted') {
    if (!raw.servicesEnabled) {
      return 'services_off';
    }
    return raw.coarseOnly ? 'approximate' : 'granted';
  }
  if (raw.status === 'undetermined') {
    return 'undetermined';
  }
  return raw.canAskAgain ? 'denied' : 'blocked';
}

export function canTrackLocation(s: PermissionState): boolean {
  // services_off is advisory: Android can report it wrongly, so still try and let a fix clear it.
  return s === 'granted' || s === 'approximate' || s === 'services_off';
}

export type PermissionAction = 'request' | 'open_settings' | 'none';

export function permissionAction(s: PermissionState): PermissionAction {
  switch (s) {
    case 'undetermined':
    case 'denied':
      return 'request';
    case 'blocked':
    case 'approximate':
    case 'services_off':
      return 'open_settings';
    case 'granted':
      return 'none';
  }
}

export const PERMISSION_COPY: Record<PermissionState, { title: string; body: string }> = {
  undetermined: {
    title: 'Location not enabled',
    body: 'Muster uses your location to show where you are on the map. It stays on your device.',
  },
  denied: {
    title: 'Location permission denied',
    body: 'Allow location access to see your position on the map.',
  },
  blocked: {
    title: 'Location blocked in Settings',
    body: 'Location access was denied. Turn it on for Muster in system Settings.',
  },
  approximate: {
    title: 'Approximate location only',
    body: 'Precise location is off, so your position and distances will be inaccurate. Turn on Precise Location in Settings.',
  },
  granted: { title: 'Location allowed', body: 'Precise location is available.' },
  services_off: {
    title: 'Location services are off',
    body: 'Turn on Location Services in system Settings to see your position.',
  },
};

/** iOS does not expose "reduced accuracy" through expo-location, so a very coarse fix implies it. */
export const APPROXIMATE_FIX_ACCURACY_M = 1000;

export function effectivePermission(
  state: PermissionState,
  lastAccuracyM: number | null,
): PermissionState {
  if (state === 'services_off' && lastAccuracyM !== null) {
    return lastAccuracyM >= APPROXIMATE_FIX_ACCURACY_M ? 'approximate' : 'granted';
  }
  if (
    state === 'granted' &&
    lastAccuracyM !== null &&
    lastAccuracyM >= APPROXIMATE_FIX_ACCURACY_M
  ) {
    return 'approximate';
  }
  return state;
}
