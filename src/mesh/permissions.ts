import { PermissionsAndroid, Platform } from 'react-native';
import type { PermissionStatus } from './types';

/** Runtime permission gate. Injected into the adapter so tests do not touch native modules. */
export interface PermissionsPort {
  /** Current state without prompting. iOS cannot be queried from JS: always `unknown`. */
  check(): Promise<PermissionStatus>;
  /** Prompts where the platform allows it. */
  request(): Promise<PermissionStatus>;
}

type AndroidPerm = Parameters<typeof PermissionsAndroid.check>[0];

/**
 * Android 12+ (API 31): BLUETOOTH_SCAN / ADVERTISE / CONNECT. Android 11 and lower: peer discovery
 * needs ACCESS_FINE_LOCATION (SDK docs/react-native-integration.md section 1).
 * iOS shows the CoreBluetooth prompt itself the first time the SDK starts BLE; there is no JS API
 * to read or request it, so the status stays `unknown` until the mesh actually runs.
 */
export function requiredAndroidPermissions(apiLevel: number): AndroidPerm[] {
  if (apiLevel >= 31) {
    return [
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
    ] as AndroidPerm[];
  }
  return ['android.permission.ACCESS_FINE_LOCATION'] as AndroidPerm[];
}

export const nativePermissions: PermissionsPort = {
  async check() {
    if (Platform.OS !== 'android') {
      return 'unknown';
    }
    const perms = requiredAndroidPermissions(Number(Platform.Version));
    const results = await Promise.all(perms.map(p => PermissionsAndroid.check(p)));
    return results.every(Boolean) ? 'granted' : 'denied';
  },
  async request() {
    if (Platform.OS !== 'android') {
      return 'unknown';
    }
    const api = Number(Platform.Version);
    const perms = requiredAndroidPermissions(api);
    const results = await PermissionsAndroid.requestMultiple(perms);
    if (api >= 33) {
      // Not required to run, only to see the foreground-service notification (and its Stop button).
      await PermissionsAndroid.request(
        'android.permission.POST_NOTIFICATIONS' as AndroidPerm,
      ).catch(() => undefined);
    }
    const values = perms.map(p => results[p]);
    if (values.every(v => v === PermissionsAndroid.RESULTS.GRANTED)) {
      return 'granted';
    }
    return values.some(v => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)
      ? 'blocked'
      : 'denied';
  },
};
