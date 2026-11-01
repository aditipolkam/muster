import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { placeFromHit } from '../src/domain/maps/places';
import { PlaceSearchSheet } from '../src/features/map/PlaceSearchSheet';
import { buildStyle } from '../src/features/map/StyleBuilder';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';

const url = (q: string) =>
  `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=${encodeURIComponent(q)}`;
const HIT = {
  place_id: 1,
  display_name: 'Ben Nevis, Highland, Scotland, United Kingdom',
  name: 'Ben Nevis',
  lat: '56.7968',
  lon: '-5.0035',
  boundingbox: ['56.7968082', '56.7969082', '-5.0035760', '-5.0034760'],
};

describe('placeFromHit', () => {
  it('turns a point (a peak) into a walking-sized area around it', () => {
    const p = placeFromHit({
      ...HIT,
      lat: 56.7968,
      lon: -5.0035,
      boundingbox: [56.7968082, 56.7969082, -5.003576, -5.003476],
    });
    expect(p.name).toBe('Ben Nevis');
    expect(p.detail).toBe('Highland, Scotland, United Kingdom');
    const [w, s, e, n] = p.bbox;
    expect(e - w).toBeCloseTo(0.1, 5);
    expect(n - s).toBeCloseTo(0.1, 5);
    expect((w + e) / 2).toBeCloseTo(-5.0035, 5);
  });

  it('keeps a big region as it is', () => {
    const p = placeFromHit({
      ...HIT,
      lat: 54.5,
      lon: -3,
      boundingbox: [54.19, 54.76, -3.5, -2.67],
    });
    expect(p.bbox).toEqual([-3.5, 54.19, -2.67, 54.76]);
  });
});

describe('PlaceSearch', () => {
  it('searches only on request, returns places, and reports being offline', async () => {
    const t = await makeTestServices();
    t.http.json.set(url('Ben Nevis'), [HIT, { junk: true }]);
    expect(t.http.requests).toHaveLength(0);
    const r = await t.services.places.search('Ben Nevis');
    expect(r.ok && r.value.map(p => p.name)).toEqual(['Ben Nevis']);

    t.http.offline = true;
    const off = await t.services.places.search('Lake District');
    expect(!off.ok && off.error.code).toBe('search_failed');
  });

  it('ignores very short queries without touching the network', async () => {
    const t = await makeTestServices();
    const r = await t.services.places.search('be');
    expect(r.ok && r.value).toEqual([]);
    expect(t.http.requests).toHaveLength(0);
  });
});

describe('PlaceSearchSheet', () => {
  it('lists results and hands the chosen place back', async () => {
    const t = await makeTestServices();
    t.http.json.set(url('Ben Nevis'), [HIT]);
    const onPick = jest.fn();
    render(
      <Harness services={t.services}>
        <PlaceSearchSheet visible onClose={jest.fn()} onPick={onPick} />
      </Harness>,
    );
    fireEvent.changeText(screen.getByTestId('place-query'), 'Ben Nevis');
    fireEvent(screen.getByTestId('place-query'), 'submitEditing');
    fireEvent.press(await screen.findByTestId('place-result'));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].name).toBe('Ben Nevis');
  });
});

describe('online map style', () => {
  const input = { styleRoot: 'file:///s/', worldBaseUri: 'file:///w.pmtiles', regions: [] };
  it('adds a remote planet source only when asked', () => {
    expect(Object.keys(buildStyle(input).sources)).toEqual(['src-world']);
    const s = buildStyle({ ...input, onlineUri: 'https://example.test/planet.pmtiles' });
    expect((s.sources['src-online'] as { url: string }).url).toBe(
      'pmtiles://https://example.test/planet.pmtiles',
    );
    expect(s.layers.some(l => l.id.startsWith('online:'))).toBe(true);
  });
});

describe('onlineSource', () => {
  it('is null without a planet, and uses the catalog planet when present', async () => {
    const t = await makeTestServices();
    expect(await t.packs.onlineSource()).toBeNull();
    await t.kv.setJson('catalog.cache', {
      catalogVersion: 1,
      generatedAt: 'x',
      planet: { url: 'https://example.test/planet.pmtiles', osmDataDate: '2026-10-29' },
      regions: [],
    });
    expect((await t.packs.onlineSource())?.uri).toBe('https://example.test/planet.pmtiles');
  });
});
