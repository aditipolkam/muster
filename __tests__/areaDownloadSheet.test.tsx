import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AreaDownloadSheet } from '../src/features/map/AreaDownloadSheet';
import { Harness } from '../src/testing/componentHarness';
import { FakeHttp } from '../src/testing/FakeHttp';
import { makePlanet } from '../src/testing/planetFixture';
import { makeTestServices } from '../src/testing/services';

const PLANET = 'http://planet.test/planet.pmtiles';
const BBOX: [number, number, number, number] = [-5.1, 56.74, -4.9, 56.85];

async function services(withPlanet: boolean) {
  const http = new FakeHttp();
  http.files.set(PLANET, { bytes: makePlanet(6) });
  if (withPlanet) {
    http.json.set('http://catalog.test/catalog.json', {
      catalogVersion: 1,
      generatedAt: 'x',
      planet: { url: PLANET, osmDataDate: '2026-10-29' },
      regions: [],
    });
  }
  return makeTestServices({ http });
}

describe('AreaDownloadSheet', () => {
  it('shows the size of the visible area and downloads it', async () => {
    const t = await services(true);
    const onStarted = jest.fn();
    render(
      <Harness services={t.services}>
        <AreaDownloadSheet
          visible
          bbox={BBOX}
          onClose={jest.fn()}
          onStarted={onStarted}
          onBrowse={jest.fn()}
        />
      </Harness>,
    );
    expect(await screen.findByText(/map tiles/)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('area-name'), 'Ben Nevis');
    fireEvent.press(screen.getByTestId('area-start'));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('Ben Nevis'));
    const regions = await t.regions.list();
    expect(regions.map(r => [r.name, r.source])).toEqual([['Ben Nevis', 'custom']]);
  });

  it('explains when no map source is configured and keeps Download disabled', async () => {
    const t = await services(false);
    render(
      <Harness services={t.services}>
        <AreaDownloadSheet
          visible
          bbox={BBOX}
          onClose={jest.fn()}
          onStarted={jest.fn()}
          onBrowse={jest.fn()}
        />
      </Harness>,
    );
    expect(await screen.findByTestId('area-error')).toBeTruthy();
    expect(screen.getByTestId('area-start').props.accessibilityState.disabled).toBe(true);
  });
});

describe('AreaDownloadSheet stability', () => {
  it('does not restart the size check when the same bounds arrive as a new array', async () => {
    const t = await services(true);
    const ui = (b: [number, number, number, number]) => (
      <Harness services={t.services}>
        <AreaDownloadSheet
          visible
          bbox={b}
          onClose={jest.fn()}
          onStarted={jest.fn()}
          onBrowse={jest.fn()}
        />
      </Harness>
    );
    const { rerender } = render(ui([...BBOX]));
    await screen.findByText(/map tiles/);
    const before = t.http.requests.length;
    rerender(ui([...BBOX]));
    rerender(ui([...BBOX]));
    expect(screen.getByText(/map tiles/)).toBeTruthy();
    expect(t.http.requests.length).toBe(before);
  });
});
