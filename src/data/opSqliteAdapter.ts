import {
  ANDROID_DATABASE_PATH,
  IOS_LIBRARY_PATH,
  open,
  type DB,
  type Scalar,
} from '@op-engineering/op-sqlite';
import { Platform } from 'react-native';
import { DbPort, RawDb, SqlValue, createSerialDb } from './DbPort';

const toScalars = (p: SqlValue[]): Scalar[] => p as Scalar[];

/** Where op-sqlite keeps databases opened by name (no `location`), as a file:// URI. */
export function sqliteDirUri(): string {
  const dir = Platform.OS === 'ios' ? IOS_LIBRARY_PATH : ANDROID_DATABASE_PATH;
  return String(dir).startsWith('file://') ? String(dir) : `file://${dir}`;
}

/** The only file that imports the SQLite driver. */
export async function openOpSqlite(name = 'muster.db'): Promise<DbPort> {
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
