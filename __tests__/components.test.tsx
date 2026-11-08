import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LATEST_VERSION } from '../src/data/migrations';
import { Harness, fakeNav } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';
import { useLocationStore } from '../src/platform/locationStore';
import { makePmtiles, hashOf } from '../src/testing/pmtilesFixture';
import { MapScreen } from '../src/features/map/MapScreen';
import { RegionsScreen } from '../src/features/maps-manager/RegionsScreen';
import { DownloadScreen } from '../src/features/maps-manager/DownloadScreen';
import { SavedScreen } from '../src/features/markers/SavedScreen';
import { SettingsScreen } from '../src/features/settings/SettingsScreen';

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return { useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]) };
});

const mockMap: { props: Record<string, any> | null; camera: Record<string, jest.Mock> } = {
  props: null,
  camera: {
    easeTo: jest.fn(),
    flyTo: jest.fn(),
    fitBounds: jest.fn(),
    jumpTo: jest.fn(),
    zoomTo: jest.fn(),
  },
};
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Map: (p: Record<string, any>) => {
      mockMap.props = p;
      React.useImperativeHandle(p.ref, () => ({ getCenter: async () => [-3.0, 54.5] }));
      return React.createElement(View, { testID: 'maplibre-map' }, p.children);
    },
    Camera: (p: Record<string, any>) => {
      React.useImperativeHandle(p.ref, () => mockMap.camera);
      return null;
    },
    GeoJSONSource: (p: Record<string, any>) =>
      React.createElement(View, { testID: `src-${p.id}` }, p.children),
    Layer: () => null,
  };
});

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const picker = require('expo-document-picker') as { getDocumentAsync: jest.Mock };

const GRANTED = {
  status: 'granted',
  canAskAgain: true,
  coarseOnly: false,
  servicesEnabled: true,
} as const;
const granted = (t: Awaited<ReturnType<typeof makeTestServices>>) => {
  t.loc.perm = { ...GRANTED };
};
const resetStore = () =>
  useLocationStore.setState({
    permission: 'undetermined',
    fix: null,
    headingDeg: null,
    watchingSince: null,
    lastError: null,
  });

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  resetStore();
  mockMap.props = null;
  Object.values(mockMap.camera).forEach(m => m.mockClear());
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  alertSpy.mockRestore();
});

const mapRoute = { key: 'Map', name: 'Map' as const, params: undefined };
const renderMap = async (t: Awaited<ReturnType<typeof makeTestServices>>) => {
  const { nav, calls } = fakeNav();
  render(
    <Harness services={t.services}>
      <MapScreen navigation={nav as never} route={mapRoute as never} />
    </Harness>,
  );
  await waitFor(() => expect(mockMap.props).not.toBeNull());
  return { calls };
};

describe('MapScreen', () => {
  it('always shows the OpenStreetMap attribution (AC7)', async () => {
    const t = await makeTestServices();
    await renderMap(t);
    expect(screen.getByTestId('attribution')).toBeTruthy();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
  });

  it('passes a local-only style to the map', async () => {
    const t = await makeTestServices();
    await renderMap(t);
    const style = mockMap.props!.mapStyle;
    expect(style.glyphs).toMatch(/^file:\/\//);
    expect(JSON.stringify(style)).not.toMatch(/https?:\/\/(?!www\.openstreetmap)/);
  });

  it('shows only search, download, offline status and recenter on top of the map', async () => {
    const t = await makeTestServices();
    await renderMap(t);
    for (const id of [
      'map-search-button',
      'map-offline-indicator',
      'map-download-button',
      'locate-button',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    for (const id of ['mesh-pill', 'online-pill', 'map-group-card', 'adventure-chip']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByText('No offline maps yet')).toBeNull();
  });

  it('the offline icon says nothing is saved here and opens the download sheet', async () => {
    const t = await makeTestServices();
    await renderMap(t);
    const icon = screen.getByTestId('map-offline-indicator');
    expect(icon.props.accessibilityLabel).toBe('No offline map for this area');
    fireEvent.press(icon);
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    expect(alertSpy.mock.calls.at(-1)![0]).toBe('No offline map for this area');
    act(() => buttons.find(b => b.text === 'Download this area')!.onPress!());
    expect(await screen.findByTestId('area-sheet')).toBeTruthy();
  });

  it('streams the online map, and says so on the offline icon, until a downloaded map covers the view', async () => {
    const t = await makeTestServices();
    await t.kv.setJson('catalog.cache', {
      catalogVersion: 1,
      generatedAt: 'x',
      planet: { url: 'https://example.test/planet.pmtiles', osmDataDate: '2026-10-29' },
      regions: [],
    });
    await renderMap(t);
    await waitFor(() =>
      expect(screen.getByTestId('map-offline-indicator').props.accessibilityLabel).toBe(
        'Online map · not saved',
      ),
    );
    expect(mockMap.props!.mapStyle.sources['src-online']).toBeTruthy();
  });

  it('shows no online map when no source is known', async () => {
    const t = await makeTestServices();
    await renderMap(t);
    expect(mockMap.props!.mapStyle.sources['src-online']).toBeUndefined();
  });

  it('outside installed coverage the icon says so, yet location and markers still render (AC6)', async () => {
    const t = await makeTestServices();
    await t.regions.upsert({
      id: 'ben',
      name: 'Ben',
      bbox: [-5.1, 56.74, -4.9, 56.85],
      minZoom: 0,
      maxZoom: 14,
      bytes: 1,
      sha256: null,
      osmDataDate: null,
      schemaV: 1,
      state: 'installed',
      progressBytes: 1,
      filePath: 'file:///docs/maps/ben.pmtiles',
      installedAt: 1,
      source: 'import',
      errorCode: null,
      sourceUrl: null,
    });
    await t.points.create({ name: 'Cairn', lat: 40, lon: -100 });
    granted(t);
    useLocationStore.setState({
      permission: 'granted',
      fix: { lat: 40, lon: -100, accM: 8, fixAt: Date.now() },
    });
    await renderMap(t);
    await waitFor(() => expect(mockMap.props).not.toBeNull());
    const move = (center: [number, number]) =>
      act(() => {
        mockMap.props!.onRegionDidChange({
          nativeEvent: {
            center,
            zoom: 11,
            bearing: 0,
            pitch: 0,
            animated: false,
            userInteraction: true,
            bounds: [0, 0, 0, 0],
          },
        });
      });
    move([-100, 40]);
    await waitFor(() =>
      expect(screen.getByTestId('map-offline-indicator').props.accessibilityLabel).toBe(
        'No offline map for this area',
      ),
    );
    expect(screen.getByTestId('src-me-puck').props.children).toBeDefined();
    // moving into coverage flips it
    move([-5.0, 56.8]);
    await waitFor(() =>
      expect(screen.getByTestId('map-offline-indicator').props.accessibilityLabel).toBe(
        'Available offline',
      ),
    );
  });

  it('recenter asks for permission, then opens Settings when it is blocked', async () => {
    const t = await makeTestServices();
    t.loc.perm = { status: 'denied', canAskAgain: true, coarseOnly: false, servicesEnabled: true };
    t.loc.nextRequestResult = GRANTED;
    useLocationStore.setState({ permission: 'denied' });
    await renderMap(t);
    await act(async () => {
      fireEvent.press(screen.getByTestId('locate-button'));
    });
    await waitFor(() => expect(useLocationStore.getState().permission).toBe('granted'));
    expect(t.loc.watchStarts).toBe(1);

    act(() => useLocationStore.setState({ permission: 'blocked', fix: null }));
    fireEvent.press(screen.getByTestId('locate-button'));
    await waitFor(() => expect(t.loc.settingsOpened).toBe(1));
  });

  it('tapping the map drops a pin; Start navigation draws the straight line and End clears it', async () => {
    const t = await makeTestServices();
    useLocationStore.setState({
      permission: 'granted',
      fix: { lat: 54.5, lon: -3.0, accM: 5, fixAt: Date.now() },
    });
    await renderMap(t);
    act(() => mockMap.props!.onPress({ nativeEvent: { lngLat: [-3.0, 54.51] } }));
    expect(await screen.findByTestId('pin-sheet')).toBeTruthy();
    expect(screen.getByTestId('pin-distance').props.children).toMatch(/1\.11 km straight line/);
    expect(await t.points.list()).toHaveLength(0);

    fireEvent.press(screen.getByTestId('pin-navigate'));
    expect(screen.queryByTestId('pin-sheet')).toBeNull();
    expect(await screen.findByTestId('navigation-bar')).toBeTruthy();
    expect(screen.getByText('Dropped pin')).toBeTruthy();
    expect(screen.getByTestId('navigation-distance').props.children).toMatch(/1\.11 km/);

    fireEvent.press(screen.getByTestId('navigation-end'));
    expect(screen.queryByTestId('navigation-bar')).toBeNull();
  });

  it('a second tap dismisses the pin, and Save keeps it as a marker', async () => {
    const t = await makeTestServices();
    await renderMap(t);
    act(() => mockMap.props!.onPress({ nativeEvent: { lngLat: [-3.0, 54.51] } }));
    await screen.findByTestId('pin-sheet');
    act(() => mockMap.props!.onPress({ nativeEvent: { lngLat: [-3.1, 54.6] } }));
    expect(screen.queryByTestId('pin-sheet')).toBeNull();

    act(() => mockMap.props!.onPress({ nativeEvent: { lngLat: [-3.0, 54.51] } }));
    await screen.findByTestId('pin-sheet');
    await act(async () => {
      fireEvent.press(screen.getByTestId('pin-save'));
    });
    await waitFor(async () => expect(await t.points.list()).toHaveLength(1));
    expect(await screen.findByTestId('marker-sheet')).toBeTruthy();
  });

  it('a saved marker can start navigation too', async () => {
    const t = await makeTestServices();
    const m = await t.points.create({ name: 'Camp', lat: 10, lon: 10 });
    render(
      <Harness services={t.services}>
        <MapScreen
          navigation={fakeNav().nav as never}
          route={{ key: 'Map', name: 'Map', params: { focusMarkerId: m.id } } as never}
        />
      </Harness>,
    );
    fireEvent.press(await screen.findByTestId('marker-navigate'));
    expect(await screen.findByTestId('navigation-bar')).toBeTruthy();
    expect(screen.getByText('Camp')).toBeTruthy();
  });

  it('long-press drops a persisted marker and shows lat/lon and distance from GPS', async () => {
    const t = await makeTestServices();
    useLocationStore.setState({
      permission: 'granted',
      fix: { lat: 54.5, lon: -3.0, accM: 5, fixAt: Date.now() },
    });
    await renderMap(t);
    await act(async () => {
      mockMap.props!.onLongPress({ nativeEvent: { lngLat: [-3.0, 54.51], point: { x: 1, y: 1 } } });
    });
    const sheet = await screen.findByTestId('marker-sheet');
    expect(sheet).toBeTruthy();
    expect(screen.getByTestId('marker-coords').props.children).toBe('54.51000° N, 3.00000° W');
    expect(screen.getByTestId('marker-distance').props.children).toMatch(
      /1\.11 km straight line, 0° N/,
    );
    const saved = await t.points.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Marker 1', lat: 54.51, lon: -3.0 });
  });

  it('says why distance is unavailable when there is no fix', async () => {
    const t = await makeTestServices();
    const m = await t.points.create({ name: 'A', lat: 1, lon: 1 });
    render(
      <Harness services={t.services}>
        <MapScreen
          navigation={fakeNav().nav as never}
          route={{ key: 'Map', name: 'Map', params: { focusMarkerId: m.id } } as never}
        />
      </Harness>,
    );
    expect((await screen.findByTestId('marker-distance')).props.children).toBe(
      'Distance unavailable: location is off',
    );
    granted(t);
    act(() => useLocationStore.setState({ permission: 'granted' }));
    expect(screen.getByTestId('marker-distance').props.children).toBe(
      'Distance unavailable: waiting for GPS',
    );
  });

  it('moves a marker to the map centre and deletes it after confirmation', async () => {
    const t = await makeTestServices();
    const m = await t.points.create({ name: 'Camp', lat: 10, lon: 10 });
    const nav = fakeNav().nav;
    render(
      <Harness services={t.services}>
        <MapScreen
          navigation={nav as never}
          route={{ key: 'Map', name: 'Map', params: { focusMarkerId: m.id } } as never}
        />
      </Harness>,
    );
    await screen.findByTestId('marker-sheet');
    fireEvent.press(screen.getByTestId('marker-move'));
    await screen.findByLabelText('Set marker here');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Set marker here'));
    });
    await waitFor(async () =>
      expect(await t.points.get(m.id)).toMatchObject({ lon: -3.0, lat: 54.5 }),
    );

    fireEvent.press(await screen.findByTestId('marker-delete'));
    const buttons = alertSpy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find(b => b.text === 'Delete')!.onPress!());
    await waitFor(async () => expect(await t.points.get(m.id)).toBeNull());
  });

  it('follow button cycles free -> follow -> follow+heading -> free and drives the camera', async () => {
    const t = await makeTestServices();
    granted(t);
    useLocationStore.setState({
      permission: 'granted',
      fix: { lat: 54.5, lon: -3.0, accM: 5, fixAt: Date.now() },
    });
    await renderMap(t);
    fireEvent.press(screen.getByTestId('locate-button'));
    expect(mockMap.camera.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-3.0, 54.5] }),
    );
    fireEvent.press(screen.getByTestId('locate-button'));
    act(() =>
      useLocationStore.setState({
        headingDeg: 135,
        fix: { lat: 54.51, lon: -3.01, accM: 5, fixAt: Date.now() },
      }),
    );
    expect(mockMap.camera.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-3.01, 54.51], bearing: 135 }),
    );
    // user pans -> back to free; fixes no longer move the camera
    act(() => {
      mockMap.props!.onRegionDidChange({
        nativeEvent: {
          center: [0, 0],
          zoom: 5,
          bearing: 0,
          pitch: 0,
          animated: false,
          userInteraction: true,
          bounds: [0, 0, 0, 0],
        },
      });
    });
    mockMap.camera.easeTo!.mockClear();
    act(() =>
      useLocationStore.setState({ fix: { lat: 54.52, lon: -3.02, accM: 5, fixAt: Date.now() } }),
    );
    expect(mockMap.camera.easeTo).not.toHaveBeenCalled();
  });
});

describe('RegionsScreen', () => {
  it('lists installed regions with sizes, totals storage, and deletes with confirmation', async () => {
    const t = await makeTestServices();
    const file = makePmtiles({ size: 4096 });
    await t.fs.writeBytes('file:///cache/a.pmtiles', file);
    const imp = await t.packs.importFile('file:///cache/a.pmtiles', 'Alps.pmtiles');
    expect(imp.ok).toBe(true);
    const { nav } = fakeNav();
    render(
      <Harness services={t.services}>
        <RegionsScreen
          navigation={nav as never}
          route={{ key: 'x', name: 'Downloaded' } as never}
        />
      </Harness>,
    );
    expect(await screen.findByText('Alps')).toBeTruthy();
    expect(await screen.findByText(/Installed/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('storage-total')).toBeTruthy());
    expect(screen.getByText(/4\.0 KB on device/)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`delete-${imp.ok ? imp.value.id : ''}`));
    const buttons = alertSpy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find(b => b.text === 'Delete')!.onPress!());
    await waitFor(() => expect(screen.getByText('No maps downloaded')).toBeTruthy());
    expect(t.fs.files.size).toBe(0);
  });

  it('shows an empty state that links to downloading', async () => {
    const t = await makeTestServices();
    const { nav, calls } = fakeNav();
    render(
      <Harness services={t.services}>
        <RegionsScreen
          navigation={nav as never}
          route={{ key: 'x', name: 'Downloaded' } as never}
        />
      </Harness>,
    );
    fireEvent.press(await screen.findByText('Download maps'));
    expect(calls[0]).toEqual(['Download']);
  });
});

describe('DownloadScreen', () => {
  const bytes = makePmtiles({ size: 20_000, seed: 3 });
  const catalog = {
    catalogVersion: 1,
    generatedAt: 'x',
    regions: [
      {
        id: 'peak',
        name: 'Peak District',
        bbox: [-2.1, 53.1, -1.6, 53.5],
        minZoom: 0,
        maxZoom: 14,
        bytes: bytes.length,
        sha256: hashOf(bytes),
        url: 'http://maps.test/peak.pmtiles',
        osmDataDate: '2026-10-29',
        schema: 1,
      },
    ],
  };
  const open = async () => {
    const t = await makeTestServices({ catalog });
    t.http.files.set('http://maps.test/peak.pmtiles', { bytes });
    const { nav } = fakeNav();
    render(
      <Harness services={t.services}>
        <DownloadScreen navigation={nav as never} route={{ key: 'x', name: 'Download' } as never} />
      </Harness>,
    );
    return t;
  };

  it('lists the catalog (built-in list when offline) and downloads a region end-to-end', async () => {
    const t = await open();
    expect(await screen.findByText('Peak District')).toBeTruthy();
    expect(await screen.findByText(/built-in map list/i)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('download-peak'));
    });
    await act(async () => {
      await t.packs.whenSettled('peak');
    });
    await waitFor(() => expect(screen.getByText('Installed')).toBeTruthy());
    expect(await t.regions.get('peak')).toMatchObject({ state: 'installed' });
  });

  it('shows plain-language failure and offers Resume when space runs out', async () => {
    const t = await open();
    t.fs.free = 100;
    await screen.findByText('Peak District');
    await act(async () => {
      fireEvent.press(screen.getByTestId('download-peak'));
    });
    await act(async () => {
      await t.packs.whenSettled('peak');
    });
    expect(await screen.findByText(/Not enough free space/)).toBeTruthy();
    expect(screen.getByTestId('resume-peak')).toBeTruthy();
  });

  it('imports a picked file and reports invalid files specifically (AC3)', async () => {
    const t = await open();
    await screen.findByText('Peak District');
    await t.fs.writeBytes('file:///cache/bad.pmtiles', new Uint8Array(400).fill(9));
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/bad.pmtiles', name: 'bad.pmtiles' }],
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Import a .pmtiles file from Files'));
    });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0]![0]).toBe('Could not import this file');
    expect(alertSpy.mock.calls[0]![1]).toMatch(/not a PMTiles file/i);

    alertSpy.mockClear();
    await t.fs.writeBytes('file:///cache/ok.pmtiles', makePmtiles({ size: 2000 }));
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/ok.pmtiles', name: 'ok.pmtiles' }],
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Import a .pmtiles file from Files'));
    });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0]![0]).toBe('Map imported');
  });
});

describe('SavedScreen', () => {
  it('lists markers with distance, navigates to the map, and deletes', async () => {
    const t = await makeTestServices();
    const m = await t.points.create({ name: 'Hut', lat: 54.51, lon: -3.0 });
    useLocationStore.setState({
      permission: 'granted',
      fix: { lat: 54.5, lon: -3.0, accM: 5, fixAt: Date.now() },
    });
    const { nav, calls } = fakeNav();
    render(
      <Harness services={t.services}>
        <SavedScreen navigation={nav as never} route={{ key: 'x', name: 'Saved' } as never} />
      </Harness>,
    );
    expect(await screen.findByText('Hut')).toBeTruthy();
    expect(screen.getByText(/1\.11 km/)).toBeTruthy();
    fireEvent.press(screen.getByText('Show on map'));
    expect(calls[0]![0]).toBe('Map');
    expect((calls[0]![1] as { focusMarkerId: string }).focusMarkerId).toBe(m.id);
    fireEvent.press(screen.getByText('Delete'));
    const buttons = alertSpy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find(b => b.text === 'Delete')!.onPress!());
    await waitFor(() => expect(screen.getByText('No saved locations')).toBeTruthy());
  });
});

describe('SettingsScreen', () => {
  it('shows permission state, diagnostics and attribution in About (AC7)', async () => {
    const t = await makeTestServices();
    t.loc.perm = { status: 'denied', canAskAgain: false, coarseOnly: false, servicesEnabled: true };
    useLocationStore.setState({ permission: 'blocked' });
    render(
      <Harness services={t.services}>
        <SettingsScreen />
      </Harness>,
    );
    expect(await screen.findByText('Location blocked in Settings')).toBeTruthy();
    expect(screen.getByText('Open system Settings')).toBeTruthy();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
    expect(
      await screen.findByText(new RegExp(`schema v${LATEST_VERSION} / v${LATEST_VERSION}`)),
    ).toBeTruthy();
  });
});

describe('OnboardingScreen', () => {
  const open = () => {
    const { OnboardingScreen } = require('../src/features/onboarding/OnboardingScreen');
    const done = jest.fn();
    render(
      <Harness services={{} as never}>
        <OnboardingScreen onDone={done} />
      </Harness>,
    );
    return done;
  };

  it('lists the benefits and asks for a name before continuing', () => {
    const done = open();
    expect(screen.getByText('Offline maps')).toBeTruthy();
    expect(screen.getByText('Group sync')).toBeTruthy();
    expect(screen.getByText('What should your group call you?')).toBeTruthy();
    expect(screen.getByTestId('onboarding-start').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId('onboarding-name'), '   ');
    expect(screen.getByTestId('onboarding-start').props.accessibilityState.disabled).toBe(true);
    expect(done).not.toHaveBeenCalled();
  });

  it('continues with the trimmed name', () => {
    const done = open();
    fireEvent.changeText(screen.getByTestId('onboarding-name'), '  Alex ');
    expect(screen.getByTestId('onboarding-start').props.accessibilityState.disabled).toBeFalsy();
    fireEvent.press(screen.getByText('Get started'));
    expect(done).toHaveBeenCalledWith('Alex');
  });
});
