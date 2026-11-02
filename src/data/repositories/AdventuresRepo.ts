import {
  Adventure,
  AdventureStatus,
  ArrivalMethod,
  Checkpoint,
  CheckpointKind,
  Completion,
  Participant,
  ParticipantState,
  PersonalProgress,
  StatusLogEntry,
  TrackPoint,
} from '../../domain/adventures/model';
import { mergeCheckpoint, mergeCompletion, mergeParticipant } from '../../domain/adventures/merge';
import { DbPort, DbReader } from '../DbPort';
import { Emitter } from '../events';

type AdventureRow = {
  id: string;
  group_id: string | null;
  owner: string | null;
  name: string;
  description: string | null;
  status: string;
  rev: number;
  start_lat: number | null;
  start_lon: number | null;
  start_label: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  tz_offset_min: number;
  resumed_at: number | null;
  active_ms: number;
  distance_m: number;
  offline_maps_covered: number | null;
  network_used: number;
  mesh_exchange_at: number | null;
};

const toAdventure = (r: AdventureRow): Adventure => ({
  id: r.id,
  groupId: r.group_id,
  owner: r.owner,
  name: r.name,
  description: r.description,
  status: r.status as AdventureStatus,
  rev: r.rev,
  startLat: r.start_lat,
  startLon: r.start_lon,
  startLabel: r.start_label,
  createdAt: r.created_at,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  tzOffsetMin: r.tz_offset_min,
  progress: {
    resumedAt: r.resumed_at,
    activeMs: r.active_ms,
    distanceM: r.distance_m,
    offlineMapsCovered: r.offline_maps_covered === null ? null : r.offline_maps_covered === 1,
    networkUsed: r.network_used === 1,
    meshExchangeAt: r.mesh_exchange_at,
  },
});

type CheckpointRow = {
  adventure_id: string;
  id: string;
  rev: number;
  ord: number;
  name: string;
  description: string | null;
  kind: string;
  lat: number;
  lon: number;
  deleted: number;
};
const toCheckpoint = (r: CheckpointRow): Checkpoint => ({
  adventureId: r.adventure_id,
  id: r.id,
  rev: r.rev,
  ord: r.ord,
  name: r.name,
  description: r.description,
  kind: r.kind as CheckpointKind,
  lat: r.lat,
  lon: r.lon,
  deleted: r.deleted === 1,
});

type CompletionRow = {
  adventure_id: string;
  checkpoint_id: string;
  address: string;
  id: string;
  at: number;
  method: string;
  published: number;
  received_at: number;
};
const toCompletion = (r: CompletionRow): Completion => ({
  adventureId: r.adventure_id,
  checkpointId: r.checkpoint_id,
  address: r.address,
  id: r.id,
  at: r.at,
  method: r.method as ArrivalMethod,
  published: r.published === 1,
  receivedAt: r.received_at,
});

type ParticipantRow = {
  adventure_id: string;
  address: string;
  name: string;
  state: string;
  seq: number;
  pid: string;
  updated_at: number;
  published: number;
};
const toParticipant = (r: ParticipantRow): Participant => ({
  adventureId: r.adventure_id,
  address: r.address,
  name: r.name,
  state: r.state as ParticipantState,
  seq: r.seq,
  pid: r.pid,
  updatedAt: r.updated_at,
  published: r.published === 1,
});

const flag = (b: boolean | null): number | null => (b === null ? null : b ? 1 : 0);

/** Adventures, checkpoints, who reached what, participants, the status log and this device's route. */
export class AdventuresRepo {
  readonly changes = new Emitter<void>();

  constructor(private readonly db: DbPort) {}

  // ---- adventures ---------------------------------------------------------------------------

  async list(): Promise<Adventure[]> {
    const rows = await this.db.all<AdventureRow>(
      'SELECT * FROM adventures ORDER BY created_at DESC, id',
    );
    return rows.map(toAdventure);
  }

  async get(id: string, db: DbReader = this.db): Promise<Adventure | null> {
    const row = await db.get<AdventureRow>('SELECT * FROM adventures WHERE id = ?', [id]);
    return row ? toAdventure(row) : null;
  }

  /** Insert or replace everything about an adventure, shared and personal. */
  async save(a: Adventure): Promise<void> {
    await this.db.run(
      `INSERT INTO adventures(id, group_id, owner, name, description, status, rev, start_lat,
         start_lon, start_label, created_at, started_at, ended_at, tz_offset_min, resumed_at,
         active_ms, distance_m, offline_maps_covered, network_used, mesh_exchange_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET group_id = excluded.group_id, owner = excluded.owner,
         name = excluded.name, description = excluded.description, status = excluded.status,
         rev = excluded.rev, start_lat = excluded.start_lat, start_lon = excluded.start_lon,
         start_label = excluded.start_label, started_at = excluded.started_at,
         ended_at = excluded.ended_at, tz_offset_min = excluded.tz_offset_min,
         resumed_at = excluded.resumed_at, active_ms = excluded.active_ms,
         distance_m = excluded.distance_m, offline_maps_covered = excluded.offline_maps_covered,
         network_used = excluded.network_used, mesh_exchange_at = excluded.mesh_exchange_at`,
      [
        a.id,
        a.groupId,
        a.owner,
        a.name,
        a.description,
        a.status,
        a.rev,
        a.startLat,
        a.startLon,
        a.startLabel,
        a.createdAt,
        a.startedAt,
        a.endedAt,
        a.tzOffsetMin,
        a.progress.resumedAt,
        a.progress.activeMs,
        a.progress.distanceM,
        flag(a.progress.offlineMapsCovered),
        a.progress.networkUsed ? 1 : 0,
        a.progress.meshExchangeAt,
      ],
    );
    this.changes.emit();
  }

  /** Personal progress only: cheap and does not touch shared fields. */
  async saveProgress(id: string, p: PersonalProgress): Promise<void> {
    await this.db.run(
      `UPDATE adventures SET resumed_at = ?, active_ms = ?, distance_m = ?,
         offline_maps_covered = ?, network_used = ?, mesh_exchange_at = ? WHERE id = ?`,
      [
        p.resumedAt,
        p.activeMs,
        p.distanceM,
        flag(p.offlineMapsCovered),
        p.networkUsed ? 1 : 0,
        p.meshExchangeAt,
        id,
      ],
    );
    this.changes.emit();
  }

  /** Add to the distance without rewriting the rest. */
  async addDistance(id: string, metres: number): Promise<void> {
    await this.db.run('UPDATE adventures SET distance_m = distance_m + ? WHERE id = ?', [
      metres,
      id,
    ]);
    this.changes.emit();
  }

  async markNetworkUsed(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.db.run('UPDATE adventures SET network_used = 1 WHERE id = ?', [id]);
    }
    if (ids.length > 0) {
      this.changes.emit();
    }
  }

  async markMeshExchange(id: string, at: number): Promise<boolean> {
    const cur = await this.get(id);
    if (!cur || cur.progress.meshExchangeAt !== null) {
      return false;
    }
    await this.db.run('UPDATE adventures SET mesh_exchange_at = ? WHERE id = ?', [at, id]);
    this.changes.emit();
    return true;
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(async tx => {
      for (const t of [
        'adventure_checkpoints',
        'checkpoint_completions',
        'adventure_participants',
        'adventure_status_log',
        'adventure_track',
      ]) {
        await tx.run(`DELETE FROM ${t} WHERE adventure_id = ?`, [id]);
      }
      // A badge stays earned after its adventure is deleted from the journal; only the link goes.
      await tx.run('UPDATE achievement_unlocks SET adventure_id = NULL WHERE adventure_id = ?', [
        id,
      ]);
      await tx.run('DELETE FROM adventures WHERE id = ?', [id]);
    });
    this.changes.emit();
  }

  // ---- status log -----------------------------------------------------------------------------

  async addLog(e: StatusLogEntry): Promise<void> {
    await this.db.run(
      `INSERT INTO adventure_status_log(adventure_id, rev, status, at) VALUES(?,?,?,?)
       ON CONFLICT(adventure_id, rev) DO NOTHING`,
      [e.adventureId, e.rev, e.status, e.at],
    );
    this.changes.emit();
  }

  async log(adventureId: string): Promise<StatusLogEntry[]> {
    const rows = await this.db.all<{
      adventure_id: string;
      rev: number;
      status: string;
      at: number;
    }>('SELECT * FROM adventure_status_log WHERE adventure_id = ? ORDER BY rev', [adventureId]);
    return rows.map(r => ({
      adventureId: r.adventure_id,
      rev: r.rev,
      status: r.status as AdventureStatus,
      at: r.at,
    }));
  }

  // ---- checkpoints ----------------------------------------------------------------------------

  async checkpoints(adventureId: string, withDeleted = false): Promise<Checkpoint[]> {
    const rows = await this.db.all<CheckpointRow>(
      `SELECT * FROM adventure_checkpoints WHERE adventure_id = ?
       ${withDeleted ? '' : 'AND deleted = 0'} ORDER BY ord, id`,
      [adventureId],
    );
    return rows.map(toCheckpoint);
  }

  async checkpoint(
    adventureId: string,
    id: string,
    db: DbReader = this.db,
  ): Promise<Checkpoint | null> {
    const r = await db.get<CheckpointRow>(
      'SELECT * FROM adventure_checkpoints WHERE adventure_id = ? AND id = ?',
      [adventureId, id],
    );
    return r ? toCheckpoint(r) : null;
  }

  /** Active checkpoints of every adventure that is currently running. */
  async runningCheckpoints(): Promise<Checkpoint[]> {
    const rows = await this.db.all<CheckpointRow>(
      `SELECT c.* FROM adventure_checkpoints c JOIN adventures a ON a.id = c.adventure_id
       WHERE a.status = 'active' AND c.deleted = 0 ORDER BY c.ord, c.id`,
    );
    return rows.map(toCheckpoint);
  }

  async nextOrd(adventureId: string): Promise<number> {
    const r = await this.db.get<{ m: number | null }>(
      'SELECT MAX(ord) AS m FROM adventure_checkpoints WHERE adventure_id = ?',
      [adventureId],
    );
    return (r?.m ?? -1) + 1;
  }

  async nextCheckpointRev(adventureId: string, id: string): Promise<number> {
    return ((await this.checkpoint(adventureId, id))?.rev ?? 0) + 1;
  }

  /** Applies the merge rule (highest revision wins). Resolves whether anything changed. */
  async applyCheckpoint(incoming: Checkpoint): Promise<boolean> {
    const changed = await this.db.transaction(async tx => {
      const cur = await this.checkpoint(incoming.adventureId, incoming.id, tx);
      if (!mergeCheckpoint(cur, incoming)) {
        return false;
      }
      await tx.run(
        `INSERT INTO adventure_checkpoints(adventure_id, id, rev, ord, name, description, kind,
           lat, lon, deleted) VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(adventure_id, id) DO UPDATE SET rev = excluded.rev, ord = excluded.ord,
           name = excluded.name, description = excluded.description, kind = excluded.kind,
           lat = excluded.lat, lon = excluded.lon, deleted = excluded.deleted`,
        [
          incoming.adventureId,
          incoming.id,
          incoming.rev,
          incoming.ord,
          incoming.name,
          incoming.description,
          incoming.kind,
          incoming.lat,
          incoming.lon,
          incoming.deleted ? 1 : 0,
        ],
      );
      return true;
    });
    if (changed) {
      this.changes.emit();
    }
    return changed;
  }

  // ---- completions ----------------------------------------------------------------------------

  async completions(adventureId: string): Promise<Completion[]> {
    const rows = await this.db.all<CompletionRow>(
      'SELECT * FROM checkpoint_completions WHERE adventure_id = ? ORDER BY at, id',
      [adventureId],
    );
    return rows.map(toCompletion);
  }

  async completion(
    adventureId: string,
    checkpointId: string,
    address: string,
    db: DbReader = this.db,
  ): Promise<Completion | null> {
    const r = await db.get<CompletionRow>(
      `SELECT * FROM checkpoint_completions
       WHERE adventure_id = ? AND checkpoint_id = ? AND address = ?`,
      [adventureId, checkpointId, address],
    );
    return r ? toCompletion(r) : null;
  }

  async countCompletions(adventureId: string): Promise<number> {
    const r = await this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM checkpoint_completions WHERE adventure_id = ?',
      [adventureId],
    );
    return Number(r?.n ?? 0);
  }

  /** Grow-only set; the earliest report of the same arrival wins. Resolves whether it changed. */
  async applyCompletion(incoming: Completion): Promise<boolean> {
    const changed = await this.db.transaction(async tx => {
      const cur = await this.completion(
        incoming.adventureId,
        incoming.checkpointId,
        incoming.address,
        tx,
      );
      if (cur && cur.id === incoming.id && incoming.published && !cur.published) {
        // The same arrival, now confirmed by the group owner's relay.
        await tx.run(
          `UPDATE checkpoint_completions SET published = 1
           WHERE adventure_id = ? AND checkpoint_id = ? AND address = ?`,
          [incoming.adventureId, incoming.checkpointId, incoming.address],
        );
        return true;
      }
      if (!mergeCompletion(cur, incoming)) {
        return false;
      }
      await tx.run(
        `INSERT INTO checkpoint_completions(adventure_id, checkpoint_id, address, id, at, method,
           published, received_at) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(adventure_id, checkpoint_id, address) DO UPDATE SET id = excluded.id,
           at = excluded.at, method = excluded.method,
           published = MAX(published, excluded.published)`,
        [
          incoming.adventureId,
          incoming.checkpointId,
          incoming.address,
          incoming.id,
          incoming.at,
          incoming.method,
          incoming.published ? 1 : 0,
          incoming.receivedAt,
        ],
      );
      return true;
    });
    if (changed) {
      this.changes.emit();
    }
    return changed;
  }

  async markCompletionPublished(adventureId: string, checkpointId: string, address: string) {
    await this.db.run(
      `UPDATE checkpoint_completions SET published = 1
       WHERE adventure_id = ? AND checkpoint_id = ? AND address = ?`,
      [adventureId, checkpointId, address],
    );
  }

  async unpublishedCompletions(adventureId: string, address: string): Promise<Completion[]> {
    const rows = await this.db.all<CompletionRow>(
      `SELECT * FROM checkpoint_completions
       WHERE adventure_id = ? AND address = ? AND published = 0 ORDER BY at`,
      [adventureId, address],
    );
    return rows.map(toCompletion);
  }

  /** Distinct checkpoints this person has reached, over every adventure. */
  async distinctCheckpointsReached(address: string): Promise<number> {
    const r = await this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT DISTINCT adventure_id, checkpoint_id FROM checkpoint_completions WHERE address = ?)`,
      [address],
    );
    return Number(r?.n ?? 0);
  }

  async myCompletionKinds(adventureId: string, address: string): Promise<CheckpointKind[]> {
    const rows = await this.db.all<{ kind: string }>(
      `SELECT c.kind AS kind FROM checkpoint_completions x
       JOIN adventure_checkpoints c ON c.adventure_id = x.adventure_id AND c.id = x.checkpoint_id
       WHERE x.adventure_id = ? AND x.address = ?`,
      [adventureId, address],
    );
    return rows.map(r => r.kind as CheckpointKind);
  }

  // ---- participants ---------------------------------------------------------------------------

  async participants(adventureId: string): Promise<Participant[]> {
    const rows = await this.db.all<ParticipantRow>(
      'SELECT * FROM adventure_participants WHERE adventure_id = ? ORDER BY updated_at, address',
      [adventureId],
    );
    return rows.map(toParticipant);
  }

  async participant(
    adventureId: string,
    address: string,
    db: DbReader = this.db,
  ): Promise<Participant | null> {
    const r = await db.get<ParticipantRow>(
      'SELECT * FROM adventure_participants WHERE adventure_id = ? AND address = ?',
      [adventureId, address],
    );
    return r ? toParticipant(r) : null;
  }

  async applyParticipant(incoming: Participant): Promise<boolean> {
    const changed = await this.db.transaction(async tx => {
      const cur = await this.participant(incoming.adventureId, incoming.address, tx);
      if (cur && cur.seq === incoming.seq && incoming.published && !cur.published) {
        await tx.run(
          `UPDATE adventure_participants SET published = 1 WHERE adventure_id = ? AND address = ?`,
          [incoming.adventureId, incoming.address],
        );
        return true;
      }
      if (!mergeParticipant(cur, incoming)) {
        return false;
      }
      await tx.run(
        `INSERT INTO adventure_participants(adventure_id, address, name, state, seq, pid,
           updated_at, published) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(adventure_id, address) DO UPDATE SET name = excluded.name,
           state = excluded.state, seq = excluded.seq, pid = excluded.pid,
           updated_at = excluded.updated_at, published = excluded.published`,
        [
          incoming.adventureId,
          incoming.address,
          incoming.name,
          incoming.state,
          incoming.seq,
          incoming.pid,
          incoming.updatedAt,
          incoming.published ? 1 : 0,
        ],
      );
      return true;
    });
    if (changed) {
      this.changes.emit();
    }
    return changed;
  }

  async markParticipantPublished(adventureId: string, address: string, seq: number) {
    await this.db.run(
      `UPDATE adventure_participants SET published = 1
       WHERE adventure_id = ? AND address = ? AND seq = ?`,
      [adventureId, address, seq],
    );
  }

  // ---- route ----------------------------------------------------------------------------------

  async appendTrack(adventureId: string, p: TrackPoint): Promise<void> {
    await this.db.run(
      `INSERT INTO adventure_track(adventure_id, seq, lat, lon, at, acc)
       VALUES(?, COALESCE((SELECT MAX(seq) + 1 FROM adventure_track WHERE adventure_id = ?), 0), ?,?,?,?)`,
      [adventureId, adventureId, p.lat, p.lon, p.at, p.accM],
    );
  }

  async track(adventureId: string): Promise<TrackPoint[]> {
    const rows = await this.db.all<{ lat: number; lon: number; at: number; acc: number }>(
      'SELECT lat, lon, at, acc FROM adventure_track WHERE adventure_id = ? ORDER BY seq',
      [adventureId],
    );
    return rows.map(r => ({ lat: r.lat, lon: r.lon, at: r.at, accM: r.acc }));
  }

  async trackCount(adventureId: string): Promise<number> {
    const r = await this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM adventure_track WHERE adventure_id = ?',
      [adventureId],
    );
    return Number(r?.n ?? 0);
  }

  // ---- cross-table facts for achievements -----------------------------------------------------

  /**
   * Has a meeting point been received by someone else? As organizer: another member's
   * acknowledgment arrived. As member: this device holds a point from the organizer and
   * acknowledged it. Both are visible in local data; neither proves delivery to everyone.
   */
  async hasRallyPoint(address: string): Promise<boolean> {
    const r = await this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM meeting_points mp JOIN groups g ON g.id = mp.group_id
       WHERE mp.deleted = 0 AND (
         (g.role = 'organizer' AND EXISTS (
            SELECT 1 FROM point_acks a
            WHERE a.group_id = mp.group_id AND a.point_id = mp.id AND a.address != ?))
         OR (g.role = 'member' AND mp.acked_rev > 0))`,
      [address],
    );
    return Number(r?.n ?? 0) > 0;
  }

  async anyMeshExchange(): Promise<boolean> {
    const r = await this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM adventures WHERE mesh_exchange_at IS NOT NULL',
    );
    return Number(r?.n ?? 0) > 0;
  }
}

export type UnlockRow = { id: string; unlockedAt: number; adventureId: string | null };

export class AchievementsRepo {
  readonly changes = new Emitter<void>();

  constructor(private readonly db: DbPort) {}

  async list(): Promise<UnlockRow[]> {
    const rows = await this.db.all<{
      id: string;
      unlocked_at: number;
      adventure_id: string | null;
    }>('SELECT * FROM achievement_unlocks ORDER BY unlocked_at, id');
    return rows.map(r => ({ id: r.id, unlockedAt: r.unlocked_at, adventureId: r.adventure_id }));
  }

  /** First unlock wins; resolves true only if this call created it. */
  async unlock(id: string, at: number, adventureId: string | null): Promise<boolean> {
    const before = await this.db.get('SELECT 1 AS x FROM achievement_unlocks WHERE id = ?', [id]);
    if (before) {
      return false;
    }
    await this.db.run(
      'INSERT INTO achievement_unlocks(id, unlocked_at, adventure_id) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',
      [id, at, adventureId],
    );
    this.changes.emit();
    return true;
  }
}
