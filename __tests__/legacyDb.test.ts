import { LEGACY_DB_NAME, moveLegacyDb } from '../src/data/legacyDb';
import { MemoryFs } from '../src/testing/MemoryFs';

const dir = 'file:///lib/';
const bytes = (s: string) => new Uint8Array(Buffer.from(s));

describe('moving the database from its pre-rename name', () => {
  it('moves trailmesh.db and its WAL/shared-memory files to the new name, once', async () => {
    const fs = new MemoryFs();
    await fs.writeBytes(dir + LEGACY_DB_NAME, bytes('main'));
    await fs.writeBytes(`${dir}${LEGACY_DB_NAME}-wal`, bytes('wal'));
    await fs.writeBytes(`${dir}${LEGACY_DB_NAME}-shm`, bytes('shm'));

    expect(await moveLegacyDb(fs, dir, 'muster.db')).toBe(true);
    expect(await fs.exists(`${dir}muster.db`)).toBe(true);
    expect(await fs.exists(`${dir}muster.db-wal`)).toBe(true);
    expect(await fs.exists(`${dir}muster.db-shm`)).toBe(true);
    expect(await fs.exists(dir + LEGACY_DB_NAME)).toBe(false);
    expect(await fs.readRange(`${dir}muster.db`, 0, 4)).toEqual(bytes('main'));

    // Second launch: nothing left to move.
    expect(await moveLegacyDb(fs, dir, 'muster.db')).toBe(false);
  });

  it('never overwrites an existing new database, and does nothing on a fresh install', async () => {
    const fs = new MemoryFs();
    await fs.writeBytes(`${dir}muster.db`, bytes('new'));
    await fs.writeBytes(dir + LEGACY_DB_NAME, bytes('old'));
    expect(await moveLegacyDb(fs, 'file:///lib', 'muster.db')).toBe(false);
    expect(await fs.readRange(`${dir}muster.db`, 0, 3)).toEqual(bytes('new'));

    const fresh = new MemoryFs();
    expect(await moveLegacyDb(fresh, dir, 'muster.db')).toBe(false);
    expect(await fresh.exists(`${dir}muster.db`)).toBe(false);
  });
});
