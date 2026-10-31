import * as Location from 'expo-location';
import { Linking } from 'react-native';
import { Fix } from '../domain/location/fix';
import { RawPermission } from '../domain/location/permission';
import { LocationPort } from './LocationPort';

async function readPermission(r: Location.LocationPermissionResponse): Promise<RawPermission> {
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
  return {
    status:
      r.status === 'granted' ? 'granted' : r.status === 'undetermined' ? 'undetermined' : 'denied',
    canAskAgain: r.canAskAgain,
    coarseOnly: r.android?.accuracy === 'coarse',
    servicesEnabled,
  };
}

const toFix = (l: Location.LocationObject): Fix => ({
  lat: l.coords.latitude,
  lon: l.coords.longitude,
  accM: l.coords.accuracy ?? Number.POSITIVE_INFINITY,
  altM: l.coords.altitude ?? undefined,
  speedMps: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : undefined,
  headingDeg: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : undefined,
  fixAt: l.timestamp,
});

export function createExpoLocationPort(): LocationPort {
  return {
    permission: async () => readPermission(await Location.getForegroundPermissionsAsync()),
    requestPermission: async () =>
      readPermission(await Location.requestForegroundPermissionsAsync()),
    openSettings: () => Linking.openSettings(),
    getCurrentFix: async () => {
      const last = await Location.getLastKnownPositionAsync();
      return last ? toFix(last) : null;
    },
    watch: async (opts, onFix, onError) => {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: opts.minIntervalMs,
          distanceInterval: opts.minDistanceM,
        },
        l => onFix(toFix(l)),
        e => onError(e),
      );
      return () => sub.remove();
    },
    watchHeading: async onHeading => {
      const sub = await Location.watchHeadingAsync(h => {
        // trueHeading is -1 when unavailable.
        onHeading(h.trueHeading >= 0 ? h.trueHeading : h.magHeading);
      });
      return () => sub.remove();
    },
  };
}
