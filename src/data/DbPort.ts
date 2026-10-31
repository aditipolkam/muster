export type SqlValue = string | number | null;

export interface DbReader {
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | null>;
}

export interface DbTx extends DbReader {
  run(sql: string, params?: SqlValue[]): Promise<void>;
}

/** SQLite behind an interface so the driver can be swapped (op-sqlite today). */
export interface DbPort extends DbTx {
  /** Runs fn in a transaction; rolls back if it throws. Serialised with all other writes. */
  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** What a driver must provide; the serial wrapper adds the single write queue. */
export interface RawDb {
  all(sql: string, params: SqlValue[]): Promise<Record<string, SqlValue>[]>;
  run(sql: string, params: SqlValue[]): Promise<void>;
  /** Must run fn atomically and roll back on throw. */
  transaction(fn: (tx: Pick<RawDb, 'all' | 'run'>) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** ARCHITECTURE.md section 6: a single write queue avoids SQLITE_BUSY between projectors and UI. */
export function createSerialDb(raw: RawDb): DbPort {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job);
    tail = next.catch(() => undefined);
    return next;
  };
  const reader = (r: Pick<RawDb, 'all'>): DbReader => ({
    all: async <T>(sql: string, params: SqlValue[] = []) => (await r.all(sql, params)) as T[],
    get: async <T>(sql: string, params: SqlValue[] = []) =>
      ((await r.all(sql, params))[0] as T | undefined) ?? null,
  });
  return {
    ...reader(raw),
    run: (sql, params = []) => enqueue(() => raw.run(sql, params)),
    transaction: fn =>
      enqueue(async () => {
        let result: unknown;
        await raw.transaction(async tx => {
          result = await fn({
            ...reader(tx),
            run: (sql, params = []) => tx.run(sql, params),
          });
        });
        return result as never;
      }),
    close: () => enqueue(() => raw.close()),
  };
}
