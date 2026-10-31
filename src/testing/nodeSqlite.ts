/**
 * Test-only DbPort backed by Node's built-in SQLite, so migrations and repositories run against
 * real SQL in Jest. `process.getBuiltinModule` is used because Jest cannot resolve `node:sqlite`.
 */
import { DbPort, RawDb, SqlValue, createSerialDb } from '../data/DbPort';

type NodeDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...p: SqlValue[]): Record<string, SqlValue>[];
    run(...p: SqlValue[]): unknown;
  };
  close(): void;
};

export function openNodeSqlite(path = ':memory:'): DbPort {
  const mod = (
    process as unknown as {
      getBuiltinModule(id: string): { DatabaseSync: new (p: string) => NodeDb };
    }
  ).getBuiltinModule('node:sqlite');
  const db = new mod.DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  const q = (sql: string, params: SqlValue[]) => db.prepare(sql).all(...params);
  const raw: RawDb = {
    all: async (sql, params) => q(sql, params).map(r => ({ ...r })),
    run: async (sql, params) => {
      db.prepare(sql).run(...params);
    },
    transaction: async fn => {
      db.exec('BEGIN');
      try {
        await fn({
          all: async (sql, params) => q(sql, params).map(r => ({ ...r })),
          run: async (sql, params) => {
            db.prepare(sql).run(...params);
          },
        });
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: async () => db.close(),
  };
  return createSerialDb(raw);
}
