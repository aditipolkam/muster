import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';
import { DbPort, RawDb, SqlValue, createSerialDb } from './DbPort';

const toScalars = (p: SqlValue[]): Scalar[] => p as Scalar[];

/** The only file that imports the SQLite driver. */
export async function openOpSqlite(name = 'trailmesh.db'): Promise<DbPort> {
  const db: DB = open({ name });
  // WAL + FK on (DATA_MODELS.md). PRAGMA journal_mode returns a row, so use execute.
  await db.execute('PRAGMA journal_mode = WAL');
  await db.execute('PRAGMA foreign_keys = ON');
  // Wait for a competing writer instead of failing at once with "database is locked".
  await db.execute('PRAGMA busy_timeout = 5000');
  const raw: RawDb = {
    all: async (sql, params) =>
      (await db.execute(sql, toScalars(params))).rows as Record<string, SqlValue>[],
    run: async (sql, params) => {
      await db.execute(sql, toScalars(params));
    },
    transaction: async fn => {
      await db.transaction(async tx => {
        await fn({
          all: async (sql, params) =>
            (
              await tx.execute(sql, toScalars(params))
            ).rows as Record<string, SqlValue>[],
          run: async (sql, params) => {
            await tx.execute(sql, toScalars(params));
          },
        });
      });
    },
    close: async () => {
      db.close();
    },
  };
  return createSerialDb(raw);
}
