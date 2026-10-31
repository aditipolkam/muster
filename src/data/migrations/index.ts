import { DbPort, DbTx } from '../DbPort';

export type Migration = {
  version: number;
  name: string;
  up: (tx: DbTx) => Promise<void>;
};

/**
 * Forward-only. Each migration is idempotent (IF NOT EXISTS) so a crash between the DDL and the
 * user_version bump is safe to re-run.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'phase1_foundation',
    up: async tx => {
      await tx.run(`CREATE TABLE IF NOT EXISTS app_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        address TEXT,
        display_name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      await tx.run(`CREATE TABLE IF NOT EXISTS map_regions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        min_lat REAL, min_lon REAL, max_lat REAL, max_lon REAL,
        min_zoom INTEGER, max_zoom INTEGER,
        bytes INTEGER, sha256 TEXT, osm_data_date TEXT, schema_v INTEGER,
        state TEXT NOT NULL,
        progress_bytes INTEGER DEFAULT 0,
        file_path TEXT,
        installed_at INTEGER,
        source TEXT,
        error_code TEXT,
        source_url TEXT
      )`);
      await tx.run(`CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      // Personal waypoints. Phase 3 migrates these into meeting_points.
      await tx.run(`CREATE TABLE IF NOT EXISTS local_points (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      await tx.run('CREATE INDEX IF NOT EXISTS local_points_updated ON local_points(updated_at)');
    },
  },
  {
    version: 2,
    name: 'phase2_events_inbox',
    up: async tx => {
      // DATA_MODELS.md `events`: inbox deduped by envelope id. `group_id` holds the topic scope
      // (`diag` in Phase 2, a group uuid from Phase 3).
      await tx.run(`CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        type TEXT NOT NULL,
        author TEXT NOT NULL,
        sent_ts INTEGER,
        received_at INTEGER NOT NULL,
        sdk_message_id TEXT,
        body TEXT NOT NULL,
        handled INTEGER NOT NULL DEFAULT 0
      )`);
      await tx.run('CREATE INDEX IF NOT EXISTS events_group_time ON events(group_id, received_at)');
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export async function currentVersion(db: DbPort): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return Number(row?.user_version ?? 0);
}

export async function runMigrations(
  db: DbPort,
  migrations: Migration[] = MIGRATIONS,
): Promise<{ from: number; to: number }> {
  const from = await currentVersion(db);
  let version = from;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= version) {
      continue;
    }
    await db.transaction(async tx => {
      await m.up(tx);
      // PRAGMA cannot be parameterised; version is a trusted integer literal.
      await tx.run(`PRAGMA user_version = ${Math.trunc(m.version)}`);
    });
    version = m.version;
  }
  return { from, to: version };
}
