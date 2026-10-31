import { Fix, gpsStatus, GPS_LOST_AFTER_MS, usableHeading } from '../src/domain/location/fix';
import {
  derivePermissionState,
  effectivePermission,
  permissionAction,
  RawPermission,
} from '../src/domain/location/permission';
import { useLocationStore } from '../src/platform/locationStore';
import { LocationService } from '../src/platform/LocationService';
import { FakeLocation } from '../src/testing/FakeLocation';
import { ManualClock } from '../src/testing/services';

const raw = (o: Partial<RawPermission>): RawPermission => ({
  status: 'granted',
  canAskAgain: true,
  coarseOnly: false,
  servicesEnabled: true,
  ...o,
});

describe('permission state machine', () => {
  it.each([
    [{ status: 'undetermined' as const }, 'undetermined'],
    [{ status: 'denied' as const, canAskAgain: true }, 'denied'],
    [{ status: 'denied' as const, canAskAgain: false }, 'blocked'],
    [{ status: 'granted' as const }, 'granted'],
    [{ status: 'granted' as const, coarseOnly: true }, 'approximate'],
    [{ status: 'granted' as const, servicesEnabled: false }, 'services_off'],
  ])('%j -> %s', (input, expected) => {
    expect(derivePermissionState(raw(input))).toBe(expected);
  });

  it('chooses the right user action', () => {
    expect(permissionAction('undetermined')).toBe('request');
    expect(permissionAction('denied')).toBe('request');
    expect(permissionAction('blocked')).toBe('open_settings');
    expect(permissionAction('approximate')).toBe('open_settings');
    expect(permissionAction('services_off')).toBe('open_settings');
    expect(permissionAction('granted')).toBe('none');
  });

  it('infers reduced accuracy from a very coarse fix (iOS cannot report it)', () => {
    expect(effectivePermission('granted', 3000)).toBe('approximate');
    expect(effectivePermission('granted', 20)).toBe('granted');
    expect(effectivePermission('denied', 3000)).toBe('denied');
  });
});

describe('gpsStatus', () => {
  const fix = (o: Partial<Fix> = {}): Fix => ({ lat: 1, lon: 1, accM: 10, fixAt: 1_000_000, ...o });
  it('is unavailable without permission', () => {
    expect(gpsStatus(0, null, 'denied', null)).toBe('unavailable');
    expect(gpsStatus(0, fix(), 'services_off', null)).toBe('unavailable');
  });
  it('acquires, then ok', () => {
    expect(gpsStatus(1, null, 'granted', 0)).toBe('acquiring');
    expect(gpsStatus(1_000_500, fix(), 'granted', 0)).toBe('ok');
  });
  it('flags poor accuracy over 100 m', () => {
    expect(gpsStatus(1_000_500, fix({ accM: 150 }), 'granted', 0)).toBe('poor');
  });
  it('is lost once the last fix is older than 15 s, and recovers on the next fix', () => {
    const f = fix();
    expect(gpsStatus(f.fixAt + GPS_LOST_AFTER_MS, f, 'granted', 0)).toBe('ok');
    expect(gpsStatus(f.fixAt + GPS_LOST_AFTER_MS + 1, f, 'granted', 0)).toBe('lost');
    const next = fix({ fixAt: f.fixAt + 20_000 });
    expect(gpsStatus(next.fixAt + 100, next, 'granted', 0)).toBe('ok');
  });
  it('treats negative heading as unavailable', () => {
    expect(usableHeading(-1)).toBeUndefined();
    expect(usableHeading(370)).toBe(10);
    expect(usableHeading(null)).toBeUndefined();
  });
});

describe('LocationService', () => {
  const setup = () => {
    useLocationStore.setState({
      permission: 'undetermined',
      fix: null,
      headingDeg: null,
      watchingSince: null,
      lastError: null,
    });
    const port = new FakeLocation();
    const clock = new ManualClock();
    return { port, clock, svc: new LocationService(port, clock) };
  };

  it('does not watch until permission is granted', async () => {
    const { port, svc } = setup();
    await svc.start();
    expect(useLocationStore.getState().permission).toBe('undetermined');
    expect(port.watchStarts).toBe(0);
  });

  it('requests permission and starts watching on grant, feeding fixes into the store', async () => {
    const { port, svc } = setup();
    port.nextRequestResult = raw({});
    expect(await svc.requestPermission()).toBe('granted');
    expect(port.watchStarts).toBe(1);
    port.emit({ lat: 1, lon: 2, accM: 5, fixAt: 123 });
    expect(useLocationStore.getState().fix).toMatchObject({ lat: 1, lon: 2 });
  });

  it('stays idle when denied or blocked', async () => {
    const { port, svc } = setup();
    port.nextRequestResult = raw({ status: 'denied', canAskAgain: false });
    expect(await svc.requestPermission()).toBe('blocked');
    expect(port.watchStarts).toBe(0);
  });

  it('is idempotent and stops cleanly', async () => {
    const { port, svc } = setup();
    port.perm = raw({});
    await Promise.all([svc.start(), svc.start(), svc.start()]);
    expect(port.watchStarts).toBe(1);
    svc.stop();
    expect(port.watchStops).toBe(1);
    expect(useLocationStore.getState().watchingSince).toBeNull();
  });

  it('stops watching when permission is revoked and restarts when it returns', async () => {
    const { port, svc } = setup();
    port.perm = raw({});
    await svc.start();
    port.perm = raw({ status: 'denied', canAskAgain: false });
    await svc.start();
    expect(port.watchStops).toBe(1);
    expect(useLocationStore.getState().permission).toBe('blocked');
    port.perm = raw({});
    await svc.start();
    expect(port.watchStarts).toBe(2);
  });

  it('throttles heading updates', async () => {
    const { port, clock, svc } = setup();
    port.perm = raw({});
    await svc.start();
    port.headingHandler?.(10);
    port.headingHandler?.(90); // same instant: dropped
    expect(useLocationStore.getState().headingDeg).toBe(10);
    clock.advance(250);
    port.headingHandler?.(90);
    expect(useLocationStore.getState().headingDeg).toBe(90);
    clock.advance(250);
    port.headingHandler?.(90.5); // < 2 degrees: dropped
    expect(useLocationStore.getState().headingDeg).toBe(90);
  });
});
