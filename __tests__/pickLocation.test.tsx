import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MapScreen } from '../src/features/map/MapScreen';
import { useLocationStore } from '../src/platform/locationStore';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';

jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(cb, [cb]) };
});

const mockMap: {
  sources: Record<string, Record<string, any>>;
  map: Record<string, any> | null;
  camera: { flyTo: jest.Mock; fitBounds: jest.Mock; easeTo: jest.Mock };
} = {
  sources: {},
  map: null,
  camera: { flyTo: jest.fn(), fitBounds: jest.fn(), easeTo: jest.fn() },
};
jest.mock('@maplibre/maplibre-react-native', () => {
  const R = require('react');
  const { View: V } = require('react-native');
  return {
    Map: (p: Record<string, any>) => {
      mockMap.map = p;
      R.useImperativeHandle(p.ref, () => ({ getCenter: async () => [-5.0, 56.8] }));
      return R.createElement(V, { testID: 'maplibre-map' }, p.children);
    },
    Camera: (p: Record<string, any>) => {
      R.useImperativeHandle(p.ref, () => mockMap.camera);
      return null;
    },
    GeoJSONSource: (p: Record<string, any>) => {
      mockMap.sources[p.id] = p;
      return R.createElement(V, { testID: `src-${p.id}` }, p.children);
    },
    Layer: () => null,
  };
});

const nav = () => {
  const calls: unknown[][] = [];
  const n: any = {
    navigate: (...a: unknown[]) => calls.push(['navigate', ...a]),
    setParams: (...a: unknown[]) => calls.push(['setParams', ...a]),
    goBack: () => calls.push(['goBack']),
    getParent: () => n,
  };
  return { n, calls };
};

const REQUEST = {
  adventureId: 'a1',
  checkpointId: undefined,
  type: 'checkpoint' as const,
  includeRegion: true,
};

async function renderPick(req: Record<string, unknown> = REQUEST) {
  const t = await makeTestServices();
  const { n, calls } = nav();
  render(
    <Harness services={t.services}>
      <MapScreen
        navigation={n}
        route={{ key: 'Map', name: 'Map', params: { pick: req, nonce: 1 } } as never}
      />
    </Harness>,
  );
  await waitFor(() => expect(mockMap.map).not.toBeNull());
  return { t, calls };
}

const moveTo = (center: [number, number]) =>
  act(() => {
    mockMap.map!.onRegionDidChange({
      nativeEvent: {
        center,
        zoom: 15,
        bearing: 0,
        pitch: 0,
        animated: false,
        userInteraction: true,
        bounds: [center[0] - 0.01, center[1] - 0.01, center[0] + 0.01, center[1] + 0.01],
      },
    });
  });

beforeEach(() => {
  mockMap.sources = {};
  mockMap.map = null;
  mockMap.camera.flyTo.mockClear();
  mockMap.camera.fitBounds.mockClear();
  useLocationStore.setState({
    permission: 'undetermined',
    fix: null,
    headingDeg: null,
    watchingSince: null,
    lastError: null,
  });
});

describe('Map: Select Location for a phase', () => {
  it('shows the pick header, the hint, a search bar and a crosshair instead of the usual map chrome', async () => {
    await renderPick();
    expect(screen.getByText('Select Location')).toBeTruthy();
    expect(screen.getByTestId('pick-hint')).toBeTruthy();
    expect(screen.getByTestId('pick-search')).toBeTruthy();
    expect(screen.getByTestId('pick-crosshair')).toBeTruthy();
    expect(screen.queryByTestId('map-search-button')).toBeNull();
    expect(screen.queryByTestId('map-download-button')).toBeNull();
    // The attribution stays on every map.
    expect(screen.getByTestId('attribution')).toBeTruthy();
  });

  it('shows the coordinates under the crosshair as the map moves', async () => {
    await renderPick();
    await moveTo([-122.4046, 37.7812]);
    expect(screen.getByTestId('pick-coords').props.children).toMatch(/37\.78/);
  });

  it('searching for a place moves the map there instead of opening a download', async () => {
    const { t } = await renderPick();
    jest.spyOn(t.services.places, 'search').mockResolvedValue({
      ok: true,
      value: [
        {
          id: '1',
          name: 'Twin Peaks',
          detail: 'San Francisco',
          lat: 37.7544,
          lon: -122.4477,
          bbox: [-122.5, 37.7, -122.4, 37.8],
        },
      ],
    });
    fireEvent.press(screen.getByTestId('pick-search'));
    const q = await screen.findByTestId('place-query');
    fireEvent.changeText(q, 'twin peaks');
    await act(async () => {
      fireEvent(q, 'submitEditing');
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('place-result'));
    });
    expect(mockMap.camera.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-122.4477, 37.7544], zoom: 15 }),
    );
    expect(screen.queryByTestId('area-download-sheet')).toBeNull();
    expect(screen.getByText('Select Location')).toBeTruthy();
  });

  it('Place Pin Here moves to the region step with a box, a size and Adjust controls', async () => {
    await renderPick();
    await moveTo([-122.4046, 37.7812]);
    fireEvent.press(screen.getByTestId('pick-place-pin'));
    expect(screen.queryByTestId('pick-crosshair')).toBeNull();
    expect(screen.getByText('Map Region (Offline)')).toBeTruthy();
    expect(screen.getByTestId('pick-region-size').props.children).toMatch(/About .* · ~4\.\d km/);
    // The region rectangle and the pin are on the map.
    const box = mockMap.sources['region-box']!.data.features[0].geometry.coordinates[0];
    expect(box).toHaveLength(5);
    expect(mockMap.sources['pin']!.data.features[0].geometry.coordinates).toEqual([
      -122.4046, 37.7812,
    ]);
    // Adjusting the region changes its size and redraws the box.
    const before = mockMap.sources['region-box']!.data.features[0].geometry.coordinates[0][1][0];
    await act(async () => {
      fireEvent.press(screen.getByTestId('region-larger'));
    });
    expect(screen.getByTestId('region-side').props.children.join('')).toBe('5.2 km');
    const after = mockMap.sources['region-box']!.data.features[0].geometry.coordinates[0][1][0];
    expect(after).toBeGreaterThan(before);
  });

  it('Confirm Location sends the place and region back to the editor', async () => {
    const { calls } = await renderPick();
    await moveTo([-122.4046, 37.7812]);
    fireEvent.press(screen.getByTestId('pick-place-pin'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('pick-confirm'));
    });
    const go = calls.find(c => c[0] === 'navigate');
    expect(go?.[1]).toBe('Activity');
    const params = (go?.[2] as any).params;
    expect(go?.[2]).toMatchObject({ screen: 'CheckpointEditor' });
    expect(params).toMatchObject({ adventureId: 'a1', type: 'checkpoint' });
    expect(params.picked).toMatchObject({ lat: 37.7812, lon: -122.4046 });
    expect(params.picked.region).toHaveLength(4);
    expect(calls).toContainEqual(['setParams', { pick: undefined }]);
  });

  it('without a map region the pin is confirmed at once', async () => {
    const { calls } = await renderPick({ ...REQUEST, includeRegion: false });
    await moveTo([10, 20]);
    await act(async () => {
      fireEvent.press(screen.getByTestId('pick-place-pin'));
    });
    const picked = (calls.find(c => c[0] === 'navigate')?.[2] as any).params.picked;
    expect(picked).toMatchObject({ lat: 20, lon: 10, region: null });
  });

  it('Back from the region step returns to the pin step; Back again cancels without a place', async () => {
    const { calls } = await renderPick();
    await moveTo([10, 20]);
    fireEvent.press(screen.getByTestId('pick-place-pin'));
    fireEvent.press(screen.getByTestId('pick-back'));
    expect(screen.getByTestId('pick-crosshair')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pick-back'));
    const params = (calls.find(c => c[0] === 'navigate')?.[2] as any).params;
    expect(params.picked).toBeUndefined();
  });

  it('taps and long-presses on the map do nothing while choosing', async () => {
    await renderPick();
    await act(async () => {
      mockMap.map!.onPress({ nativeEvent: { lngLat: [1, 2] } });
      mockMap.map!.onLongPress({ nativeEvent: { lngLat: [1, 2] } });
    });
    expect(screen.queryByTestId('pin-sheet')).toBeNull();
  });
});
