import React from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { distanceM } from '../src/domain/geo';
import { latToTileY, lonToTileX } from '../src/domain/maps/pmtilesDir';
import { aStar } from '../src/domain/routing/astar';
import { buildGraph, walkFactor, WalkGraph } from '../src/domain/routing/graph';
import { decodeLines } from '../src/domain/routing/mvt';
import { MAX_ROUTE_M, planRoute, routeProgress, RouterPort } from '../src/domain/routing/router';
import { PmtilesTileSource } from '../src/domain/routing/tileSource';
import { NavigationBar } from '../src/features/map/NavigationBar';
import { createTrailRouter, useTrailRoute } from '../src/features/map/trailRouter';
import { MemoryFs } from '../src/testing/MemoryFs';
import { buildArchive, encodeTile, TestLine } from '../src/testing/mvtEncode';
import { Harness } from '../src/testing/componentHarness';
import { makeTestServices } from '../src/testing/services';

const Z = 15;
const EXT = 4096;
const ORIGIN = { lat: 54.45, lon: -3.02 };
const TX = lonToTileX(ORIGIN.lon, Z);
const TY = latToTileY(ORIGIN.lat, Z);

/** Tile pixel (in tile tx,ty at Z) -> lat/lon. */
const toLatLon = (tx: number, ty: number, px: number, py: number) => {
  const n = 2 ** Z;
  const u = (tx + px / EXT) / n;
  const v = (ty + py / EXT) / n;
  return {
    lon: u * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI,
  };
};
/** Metres per tile pixel here. */
const M_PER_PX = distanceM(toLatLon(TX, TY, 0, 2048), toLatLon(TX, TY, 1000, 2048)) / 1000;
const px = (m: number) => Math.round(m / M_PER_PX);

const path = (parts: [number, number][][], kind = 'path', detail = 'footway'): TestLine => ({
  props: { kind, kind_detail: detail },
  parts,
});
const roads = (lines: TestLine[]) => ({ name: 'roads', lines });
const tile = (x: number, y: number, lines: TestLine[]) => ({
  z: Z,
  x,
  y,
  layer: decodeLines(encodeTile([roads(lines)]), 'roads', ['kind', 'kind_detail'])!,
});

function components(g: WalkGraph) {
  return new Set(Array.from(g.components())).size;
}

describe('vector tile decoding', () => {
  it('reads line features and the kept tags of one layer only', () => {
    const bytes = encodeTile([
      {
        name: 'water',
        lines: [
          path([
            [
              [0, 0],
              [10, 10],
            ],
          ]),
        ],
      },
      roads([
        {
          props: { kind: 'path', kind_detail: 'track', name: 'Old road', surface: 'gravel' },
          parts: [
            [
              [10, 20],
              [30, 20],
              [30, 60],
            ],
            [
              [-5, 4100],
              [100, 4000],
            ],
          ],
        },
      ]),
    ]);
    const layer = decodeLines(bytes, 'roads', ['kind', 'kind_detail', 'name'])!;
    expect(layer.extent).toBe(4096);
    expect(layer.lines).toHaveLength(1);
    expect(layer.lines[0]!.props).toEqual({ kind: 'path', kind_detail: 'track', name: 'Old road' });
    expect(layer.lines[0]!.parts).toEqual([
      [
        [10, 20],
        [30, 20],
        [30, 60],
      ],
      [
        [-5, 4100],
        [100, 4000],
      ],
    ]);
    expect(decodeLines(bytes, 'buildings', ['kind'])).toBeNull();
  });
});

describe('walking factors', () => {
  it('prefers paths, allows quiet roads, avoids big roads and never uses motorways or private ways', () => {
    expect(walkFactor({ kind: 'path', kind_detail: 'footway' })).toBe(1);
    expect(walkFactor({ kind: 'path', kind_detail: 'steps' })).toBeGreaterThan(1);
    expect(walkFactor({ kind: 'minor_road', kind_detail: 'residential' })).toBeGreaterThan(1);
    expect(walkFactor({ kind: 'major_road', kind_detail: 'trunk' })).toBeGreaterThan(2);
    expect(walkFactor({ kind: 'highway', kind_detail: 'motorway' })).toBeNull();
    expect(walkFactor({ kind: 'path', access: 'private' })).toBeNull();
    expect(walkFactor({ kind: 'ferry' })).toBeNull();
  });
});

describe('graph building', () => {
  it('joins a path that crosses a tile edge, dropping the buffer overlap', () => {
    // The same path, as Planetiler writes it into two neighbouring tiles: each copy runs a few
    // pixels into the buffer, and the copies do not meet exactly at the edge.
    const g = buildGraph([
      tile(TX, TY, [
        path([
          [
            [2000, 2048],
            [4110, 2050],
          ],
        ]),
      ]),
      tile(TX + 1, TY, [
        path([
          [
            [-12, 2051],
            [2000, 2052],
          ],
        ]),
      ]),
    ]);
    expect(components(g)).toBe(1);
    const a = g.nearest(toLatLon(TX, TY, 2000, 2048), 1)!;
    const b = g.nearest(toLatLon(TX + 1, TY, 2000, 2052), 1)!;
    const route = aStar(g, a.id, b.id)!;
    expect(route).not.toBeNull();
    // Nothing is left in the buffer beyond the tile edge.
    const edgeLon = toLatLon(TX + 1, TY, 0, 0).lon;
    const tileA = route.map(id => g.at(id)).filter(p => p.lon < edgeLon - 1e-9);
    expect(tileA.every(p => p.lon <= edgeLon)).toBe(true);
  });

  it('snaps a dangling line end to a path within a few metres, but not further', () => {
    const near = buildGraph([
      tile(TX, TY, [
        path([
          [
            [1000, 1000],
            [2000, 1000],
          ],
        ]),
        path([
          [
            [2000 + px(2), 1000],
            [3000, 1000],
          ],
        ]),
      ]),
    ]);
    expect(components(near)).toBe(1);
    const far = buildGraph([
      tile(TX, TY, [
        path([
          [
            [1000, 1000],
            [2000, 1000],
          ],
        ]),
        path([
          [
            [2000 + px(20), 1000],
            [3000, 1000],
          ],
        ]),
      ]),
    ]);
    expect(components(far)).toBe(2);
  });

  it('leaves out ways people should not walk', () => {
    const g = buildGraph([
      tile(TX, TY, [
        path(
          [
            [
              [0, 0],
              [4000, 0],
            ],
          ],
          'highway',
          'motorway',
        ),
      ]),
    ]);
    expect(g.nodeCount).toBe(0);
  });
});

describe('A*', () => {
  /** a -- b -- c along a path, and a direct but busy road a -- c. */
  const square = (roadFactor: number) => {
    const g = new WalkGraph();
    const a = g.node('a', 54.45, -3.02);
    const b = g.node('b', 54.452, -3.019);
    const c = g.node('c', 54.454, -3.02);
    const d = g.node('d', 54.46, -3.0);
    g.edge(a, b, 1);
    g.edge(b, c, 1);
    g.edge(a, c, roadFactor);
    return { g, a, b, c, d };
  };
  it('takes the path when the road costs more, and the road when it is worth it', () => {
    const s = square(1.8);
    expect(aStar(s.g, s.a, s.c)).toEqual([s.a, s.b, s.c]);
    const t = square(1);
    expect(aStar(t.g, t.a, t.c)).toEqual([t.a, t.c]);
  });
  it('returns null when the points are not connected', () => {
    const s = square(1);
    expect(aStar(s.g, s.a, s.d)).toBeNull();
  });
});

/** Two tiles: an L-shaped path from tile A into tile B. */
function archive() {
  const a = encodeTile([
    roads([
      path([
        [
          [500, 500],
          [500, 3000],
          [4106, 3000],
        ],
      ]),
    ]),
  ]);
  const b = encodeTile([
    roads([
      path([
        [
          [-8, 3001],
          [1500, 3001],
        ],
      ]),
    ]),
  ]);
  return buildArchive(
    [
      { z: Z, x: TX, y: TY, data: a },
      { z: Z, x: TX + 1, y: TY, data: b },
    ],
    { min: 0, max: Z },
  );
}
const readFrom = (bytes: Uint8Array) => async (offset: number, length: number) =>
  bytes.subarray(offset, offset + length);

describe('planRoute', () => {
  const start = toLatLon(TX, TY, 500, 520);
  const end = toLatLon(TX + 1, TY, 1490, 3001);

  it('routes along the paths from a downloaded archive', async () => {
    const src = await PmtilesTileSource.open(readFrom(archive()));
    const r = await planRoute(src, start, end);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.coords[0]).toEqual(start);
    expect(r.coords[r.coords.length - 1]).toEqual(end);
    // Down the first leg, then along the second: longer than the straight line.
    expect(r.distanceM).toBeGreaterThan(distanceM(start, end) * 1.2);
    expect(r.stats.tiles).toBe(2);
    expect(r.stats.zoom).toBe(Z);
  });

  it('gives up when an end is too far from any path, or the ends are too far apart', async () => {
    const src = await PmtilesTileSource.open(readFrom(archive()));
    const offPath = toLatLon(TX, TY, 3500, 1000 - px(400));
    const r = await planRoute(src, offPath, end);
    expect(r).toMatchObject({ ok: false, reason: 'off_network' });
    const far = { lat: start.lat + (MAX_ROUTE_M + 1000) / 111_000, lon: start.lon };
    expect(await planRoute(src, start, far)).toMatchObject({ ok: false, reason: 'too_far' });
  });

  it('says there is no map when no tile covers the place', async () => {
    const src = await PmtilesTileSource.open(readFrom(archive()));
    const elsewhere = { lat: 10, lon: 10 };
    const r = await planRoute(src, elsewhere, { lat: 10.01, lon: 10.01 });
    expect(r).toMatchObject({ ok: false, reason: 'no_map' });
  });
});

describe('routeProgress', () => {
  it('measures what is left from the nearest point, and finds a point ahead', () => {
    const coords = [0, 1, 2, 3, 4].map(i => ({ lat: 54 + i * 0.001, lon: -3 }));
    const p = routeProgress(coords, { lat: 54.001, lon: -3.0001 }, 150);
    expect(p.index).toBe(1);
    expect(p.offRouteM).toBeLessThan(10);
    expect(p.remainingM).toBeGreaterThan(330);
    expect(p.remainingM).toBeLessThan(345);
    expect(p.ahead).toEqual(coords[3]);
  });
});

describe('the app router over downloaded regions', () => {
  it('uses the installed region that holds both ends, and says no_map otherwise', async () => {
    const fs = new MemoryFs();
    const uri = `${fs.root}maps/test.pmtiles`;
    await fs.writeBytes(uri, archive());
    const start = toLatLon(TX, TY, 500, 520);
    const end = toLatLon(TX + 1, TY, 1490, 3001);
    const region = {
      id: 'r',
      name: 'Test',
      bbox: [start.lon - 0.05, start.lat - 0.05, end.lon + 0.05, end.lat + 0.05] as [
        number,
        number,
        number,
        number,
      ],
      minZoom: 0,
      maxZoom: Z,
      bytes: 1,
      sha256: null,
      osmDataDate: null,
      schemaV: 1,
      state: 'installed' as const,
      progressBytes: 0,
      filePath: uri,
      installedAt: 1,
      source: 'custom' as const,
      errorCode: null,
      sourceUrl: null,
    };
    expect((await createTrailRouter(fs, [region]).route(start, end)).ok).toBe(true);
    expect(await createTrailRouter(fs, []).route(start, end)).toEqual({
      ok: false,
      reason: 'no_map',
    });
  });
});

describe('navigation falls back to the straight line', () => {
  const target = { name: 'Camp', lat: 54.46, lon: -3.02 };
  const fix = { lat: 54.45, lon: -3.02 };
  const okRouter: RouterPort = {
    route: async (from, to) => ({
      ok: true,
      coords: [from, { lat: 54.455, lon: -3.025 }, to],
      distanceM: 1300,
      snapM: { start: 0, end: 0 },
      stats: { zoom: 15, tiles: 1, nodes: 3, edges: 2, loadMs: 0, buildMs: 0, searchMs: 0 },
    }),
  };
  const noRouter: RouterPort = { route: async () => ({ ok: false, reason: 'off_network' }) };

  it('the hook finds a route, or reports why not', async () => {
    const ok = renderHook(() => useTrailRoute(okRouter, target, fix));
    await waitFor(() => expect(ok.result.current.status).toBe('ok'));
    const none = renderHook(() => useTrailRoute(noRouter, target, fix));
    await waitFor(() =>
      expect(none.result.current).toEqual({ status: 'none', reason: 'off_network' }),
    );
    const idle = renderHook(() => useTrailRoute(okRouter, null, fix));
    expect(idle.result.current.status).toBe('idle');
  });

  it('labels "Via trail" with the distance along the route, else "Straight line"', async () => {
    const t = await makeTestServices();
    const bar = (trail: React.ComponentProps<typeof NavigationBar>['trail']) => (
      <Harness services={t.services}>
        <NavigationBar
          target={{ ...target, kind: 'meeting' }}
          fix={{ ...fix, accM: 5, fixAt: Date.now() }}
          heading={null}
          units="metric"
          paceKmh={4}
          trail={trail}
          top={0}
          bottom={0}
          onView={() => undefined}
          onEnd={() => undefined}
        />
      </Harness>
    );
    const view = render(bar({ remainingM: 1234, ahead: { lat: 54.452, lon: -3.02 } }));
    expect(screen.getByText('Via trail · 1.23 km')).toBeTruthy();
    expect(screen.getByTestId('navigation-distance').props.children).toBe('1.23 km');
    view.rerender(bar(null));
    expect(screen.getByText('Straight line, not a trail route')).toBeTruthy();
    expect(screen.getByTestId('navigation-distance').props.children).toBe('1.11 km');
    view.rerender(bar('finding'));
    expect(screen.getByText('Looking for a trail route…')).toBeTruthy();
    // A route was looked for and none found: say why, under the straight-line chip.
    view.rerender(bar({ none: 'no_map' }));
    expect(screen.getByText('Straight line, not a trail route')).toBeTruthy();
    expect(screen.getByTestId('nav-route-reason').props.children).toBe(
      'Download the map of this area to get a trail route.',
    );
    view.rerender(bar({ none: 'off_network' }));
    expect(screen.getByTestId('nav-route-reason').props.children).toMatch(/No path within 250 m/);
  });
});
