import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LATEST_VERSION, MIGRATIONS, currentVersion, runMigrations } from '../src/data/migrations';
import { KvRepo } from '../src/data/repositories/KvRepo';
import { PointsRepo } from '../src/data/repositories/PointsRepo';
import { RegionsRepo } from '../src/data/repositories/RegionsRepo';
import { RegionRecord } from '../src/domain/maps/region';
import { ManualClock, testId } from '../src/testing/services';
import { openNodeSqlite } from '../src/testing/nodeSqlite';

describe('migrations', () => {
  it('migrates v0 -> latest and creates the Phase 1 and 2 tables', async () => {
    const db = openNodeSqlite();
    expect(await currentVersion(db)).toBe(0);
    expect(await runMigrations(db)).toEqual({ from: 0, to: LATEST_VERSION });
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
    const tables = (
      await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
    ).map(t => t.name);
    expect(tables).toEqual(
      expect.arrayContaining(['app_profile', 'map_regions', 'kv', 'local_points', 'events']),
    );
  });

  it('is a no-op when already current, and re-runnable if the version bump was lost', async () => {
    const db = openNodeSqlite();
    await runMigrations(db);
    expect((await runMigrations(db)).from).toBe(LATEST_VERSION);
    await db.run('PRAGMA user_version = 0'); // crash between DDL and version bump
    await runMigrations(db); // IF NOT EXISTS makes this safe
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
  });

  it('rolls back a failing migration and leaves the version untouched', async () => {
    const db = openNodeSqlite();
    await runMigrations(db);
    const bad = {
      version: LATEST_VERSION + 1,
      name: 'bad',
      up: async (tx: { run: (s: string) => Promise<void> }) => {
        await tx.run('CREATE TABLE half_done (x INTEGER)');
        throw new Error('boom');
      },
    };
    await expect(runMigrations(db, [...MIGRATIONS, bad])).rejects.toThrow('boom');
    expect(await currentVersion(db)).toBe(LATEST_VERSION);
    const t = await db.all("SELECT name FROM sqlite_master WHERE name='half_done'");
    expect(t).toHaveLength(0);
  });
});

describe('repositories', () => {
  const setup = async () => {
    const db = openNodeSqlite();
    await runMigrations(db);
    const clock = new ManualClock();
    return {
      db,
      clock,
      points: new PointsRepo(db, clock, testId),
      kv: new KvRepo(db),
      regions: new RegionsRepo(db),
    };
  };

  it('PointsRepo: create, read, update, delete', async () => {
    const { points, clock } = await setup();
    const m = await points.create({ name: '  Camp  ', lat: 54.5, lon: -3.1 });
    expect(m.name).toBe('Camp');
    clock.advance(1000);
    const u = await points.update(m.id, { lat: 54.6 });
    expect(u).toMatchObject({ lat: 54.6, lon: -3.1, name: 'Camp' });
    expect(u!.updatedAt).toBeGreaterThan(m.createdAt);
    expect(await points.list()).toHaveLength(1);
    await points.delete(m.id);
    expect(await points.get(m.id)).toBeNull();
    expect(await points.update('nope', { name: 'x' })).toBeNull();
  });

  it('PointsRepo rejects invalid data', async () => {
    const { points } = await setup();
    await expect(points.create({ name: '', lat: 0, lon: 0 })).rejects.toThrow();
    await expect(points.create({ name: 'x', lat: 91, lon: 0 })).rejects.toThrow();
    await expect(points.create({ name: 'x', lat: 0, lon: 181 })).rejects.toThrow();
    await expect(points.create({ name: 'x'.repeat(81), lat: 0, lon: 0 })).rejects.toThrow();
    const m = await points.create({ name: 'ok', lat: 0, lon: 0 });
    await expect(points.update(m.id, { lat: NaN })).rejects.toThrow();
  });

  it('PointsRepo emits change events', async () => {
    const { points } = await setup();
    const fn = jest.fn();
    points.changes.subscribe(fn);
    const m = await points.create({ name: 'a', lat: 1, lon: 1 });
    await points.update(m.id, { name: 'b' });
    await points.delete(m.id);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('KvRepo get/set/json/delete', async () => {
    const { kv } = await setup();
    expect(await kv.get('a')).toBeNull();
    await kv.set('a', '1');
    await kv.set('a', '2');
    expect(await kv.get('a')).toBe('2');
    await kv.setJson('j', { x: 1 });
    expect(await kv.getJson('j')).toEqual({ x: 1 });
    await kv.set('bad', '{not json');
    expect(await kv.getJson('bad')).toBeNull();
    await kv.delete('a');
    expect(await kv.get('a')).toBeNull();
  });

  it('RegionsRepo upsert/list/state/delete', async () => {
    const { regions } = await setup();
    const r: RegionRecord = {
      id: 'x',
      name: 'X',
      bbox: [1, 2, 3, 4],
      minZoom: 0,
      maxZoom: 14,
      bytes: 100,
      sha256: 'a'.repeat(64),
      osmDataDate: '2026-10-29',
      schemaV: 1,
      state: 'downloading',
      progressBytes: 0,
      filePath: null,
      installedAt: null,
      source: 'catalog',
      errorCode: null,
      sourceUrl: 'http://x/y',
    };
    await regions.upsert(r);
    expect(await regions.get('x')).toEqual(r);
    await regions.setProgress('x', 50);
    await regions.setState('x', 'failed', { errorCode: 'network' });
    expect(await regions.get('x')).toMatchObject({
      state: 'failed',
      errorCode: 'network',
      progressBytes: 50,
    });
    await regions.upsert({ ...r, state: 'installed', filePath: 'file:///a' });
    expect((await regions.listInstalled()).map(x => x.id)).toEqual(['x']);
    await regions.delete('x');
    expect(await regions.list()).toEqual([]);
  });
});

describe('persistence across restarts (real SQLite file)', () => {
  it('markers, regions and kv survive closing and reopening the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'muster-'));
    const path = join(dir, 't.db');
    try {
      const db1 = openNodeSqlite(path);
      await runMigrations(db1);
      const clock = new ManualClock();
      const m = await new PointsRepo(db1, clock, testId).create({
        name: 'Summit',
        lat: 56.7969,
        lon: -5.0036,
      });
      await new KvRepo(db1).set('style.assets.version', 'v1');
      await new RegionsRepo(db1).upsert({
        id: 'ben',
        name: 'Ben',
        bbox: [-5.1, 56.74, -4.9, 56.85],
        minZoom: 0,
        maxZoom: 14,
        bytes: 5,
        sha256: null,
        osmDataDate: null,
        schemaV: 1,
        state: 'installed',
        progressBytes: 5,
        filePath: 'file:///maps/ben.pmtiles',
        installedAt: 1,
        source: 'import',
        errorCode: null,
        sourceUrl: null,
      });
      await db1.close();

      const db2 = openNodeSqlite(path); // "app restart"
      expect((await runMigrations(db2)).from).toBe(LATEST_VERSION);
      expect(await new PointsRepo(db2, clock, testId).get(m.id)).toMatchObject({
        name: 'Summit',
        lat: 56.7969,
        lon: -5.0036,
      });
      expect(await new KvRepo(db2).get('style.assets.version')).toBe('v1');
      expect((await new RegionsRepo(db2).listInstalled())[0]).toMatchObject({
        id: 'ben',
        filePath: 'file:///maps/ben.pmtiles',
      });
      await db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serialises concurrent writes without SQLITE_BUSY', async () => {
    const db = openNodeSqlite();
    await runMigrations(db);
    const points = new PointsRepo(db, new ManualClock(), testId);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => points.create({ name: `p${i}`, lat: i % 80, lon: i })),
    );
    expect(await points.list()).toHaveLength(50);
  });
});
