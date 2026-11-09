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
  {
    version: 3,
    name: 'phase3_groups',
    up: async tx => {
      await tx.run(`CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        organizer TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        joined_at INTEGER,
        member_rev INTEGER NOT NULL DEFAULT 0
      )`);
      await tx.run(`CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        address TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        state TEXT NOT NULL,
        rev INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (group_id, address)
      )`);
      // Organizer only. Only the token hash is stored (the token is a bearer secret).
      await tx.run(`CREATE TABLE IF NOT EXISTS group_invites (
        token_hash TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        auto_approve INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        used_by TEXT,
        created_at INTEGER NOT NULL
      )`);
      // The winning version per point; a removed point stays as a tombstone (deleted = 1) so an
      // older update that arrives late cannot bring it back.
      await tx.run(`CREATE TABLE IF NOT EXISTS meeting_points (
        group_id TEXT NOT NULL,
        id TEXT NOT NULL,
        rev INTEGER NOT NULL,
        name TEXT NOT NULL,
        note TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        acked_rev INTEGER NOT NULL DEFAULT 0,
        ack_published INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, id)
      )`);
      await tx.run(`CREATE TABLE IF NOT EXISTS point_acks (
        group_id TEXT NOT NULL,
        point_id TEXT NOT NULL,
        address TEXT NOT NULL,
        rev INTEGER NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (group_id, point_id, address)
      )`);
    },
  },
  {
    version: 4,
    name: 'phase7_adventures',
    up: async tx => {
      // Shared fields (name, status, rev, start) come from the owner; `progress` columns are
      // this device's own record and are never published.
      await tx.run(`CREATE TABLE IF NOT EXISTS adventures (
        id TEXT PRIMARY KEY,
        group_id TEXT,
        owner TEXT,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        rev INTEGER NOT NULL DEFAULT 1,
        start_lat REAL, start_lon REAL, start_label TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        tz_offset_min INTEGER NOT NULL DEFAULT 0,
        resumed_at INTEGER,
        active_ms INTEGER NOT NULL DEFAULT 0,
        distance_m REAL NOT NULL DEFAULT 0,
        offline_maps_covered INTEGER,
        network_used INTEGER NOT NULL DEFAULT 0,
        mesh_exchange_at INTEGER
      )`);
      await tx.run(
        'CREATE INDEX IF NOT EXISTS adventures_status ON adventures(status, created_at)',
      );
      await tx.run('CREATE INDEX IF NOT EXISTS adventures_group ON adventures(group_id)');
      await tx.run(`CREATE TABLE IF NOT EXISTS adventure_checkpoints (
        adventure_id TEXT NOT NULL,
        id TEXT NOT NULL,
        rev INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        kind TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (adventure_id, id)
      )`);
      // One row per (adventure, checkpoint, person); grows only. `published` matters for this
      // device's own rows: 0 until the group owner was handed the arrival.
      await tx.run(`CREATE TABLE IF NOT EXISTS checkpoint_completions (
        adventure_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        address TEXT NOT NULL,
        id TEXT NOT NULL,
        at INTEGER NOT NULL,
        method TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 0,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (adventure_id, checkpoint_id, address)
      )`);
      await tx.run(`CREATE TABLE IF NOT EXISTS adventure_participants (
        adventure_id TEXT NOT NULL,
        address TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL,
        seq INTEGER NOT NULL,
        pid TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        published INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (adventure_id, address)
      )`);
      await tx.run(`CREATE TABLE IF NOT EXISTS adventure_status_log (
        adventure_id TEXT NOT NULL,
        rev INTEGER NOT NULL,
        status TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (adventure_id, rev)
      )`);
      // This device's own route. Never leaves the device.
      await tx.run(`CREATE TABLE IF NOT EXISTS adventure_track (
        adventure_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        at INTEGER NOT NULL,
        acc REAL NOT NULL,
        PRIMARY KEY (adventure_id, seq)
      )`);
      await tx.run(`CREATE TABLE IF NOT EXISTS achievement_unlocks (
        id TEXT PRIMARY KEY,
        unlocked_at INTEGER NOT NULL,
        adventure_id TEXT
      )`);
    },
  },
  {
    version: 5,
    name: 'group_activities',
    up: async tx => {
      // Re-runnable: skip what an earlier, half-recorded run already did.
      const columns = async (table: string) =>
        (await tx.all<{ name: string }>(`PRAGMA table_info(${table})`)).map(c => c.name);
      // Activities: ordered flag and the map area to download (JSON, validated on read).
      const adv = await columns('adventures');
      if (!adv.includes('ordered')) {
        await tx.run('ALTER TABLE adventures ADD COLUMN ordered INTEGER NOT NULL DEFAULT 0');
      }
      if (!adv.includes('activity')) {
        await tx.run('ALTER TABLE adventures ADD COLUMN activity INTEGER NOT NULL DEFAULT 0');
      }
      if (!adv.includes('finished_at')) {
        await tx.run('ALTER TABLE adventures ADD COLUMN finished_at INTEGER');
      }
      if (!adv.includes('region')) {
        await tx.run('ALTER TABLE adventures ADD COLUMN region TEXT');
      }
      // A phase may be a task with no place, so lat/lon become nullable. SQLite cannot drop
      // NOT NULL in place: rebuild the table and keep every row.
      if (!(await columns('adventure_checkpoints')).includes('task')) {
        await tx.run('DROP TABLE IF EXISTS adventure_checkpoints_v5');
        await tx.run(`CREATE TABLE adventure_checkpoints_v5 (
          adventure_id TEXT NOT NULL,
          id TEXT NOT NULL,
          rev INTEGER NOT NULL,
          ord INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          kind TEXT NOT NULL,
          lat REAL,
          lon REAL,
          task TEXT,
          deleted INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (adventure_id, id)
        )`);
        await tx.run(`INSERT INTO adventure_checkpoints_v5(adventure_id, id, rev, ord, name,
            description, kind, lat, lon, task, deleted)
          SELECT adventure_id, id, rev, ord, name, description, kind, lat, lon, NULL, deleted
          FROM adventure_checkpoints`);
        await tx.run('DROP TABLE adventure_checkpoints');
        await tx.run('ALTER TABLE adventure_checkpoints_v5 RENAME TO adventure_checkpoints');
      }
    },
  },
  {
    version: 6,
    name: 'activity_phases',
    up: async tx => {
      // Re-runnable: add only the columns that are missing.
      const cols = (await tx.all<{ name: string }>('PRAGMA table_info(adventure_checkpoints)')).map(
        c => c.name,
      );
      const add = async (name: string, ddl: string) => {
        if (!cols.includes(name)) {
          await tx.run(`ALTER TABLE adventure_checkpoints ADD COLUMN ${ddl}`);
        }
      };
      await add('type', "type TEXT NOT NULL DEFAULT 'checkpoint'");
      await add('radius_m', 'radius_m INTEGER');
      await add('require_photo', 'require_photo INTEGER NOT NULL DEFAULT 0');
      await add('region', 'region TEXT');
      // This person's own note and photo for a phase. Never sent; the photo is a file here.
      await tx.run(`CREATE TABLE IF NOT EXISTS phase_records (
        adventure_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        note TEXT,
        photo_uri TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (adventure_id, checkpoint_id)
      )`);
    },
  },
  {
    version: 7,
    name: 'group_trip_map',
    up: async tx => {
      const cols = (await tx.all<{ name: string }>('PRAGMA table_info(groups)')).map(c => c.name);
      if (!cols.includes('trip_area')) {
        // The group's trip map as `MapAreaWire` JSON; null when the organizer set none.
        await tx.run('ALTER TABLE groups ADD COLUMN trip_area TEXT');
      }
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
