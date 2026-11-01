import { mergePoint } from '../../domain/groups/merge';
import type { MeetingPoint, PointAck } from '../../domain/groups/model';
import { DbPort, DbReader } from '../DbPort';
import { Emitter } from '../events';

type Row = {
  group_id: string;
  id: string;
  rev: number;
  name: string;
  note: string | null;
  lat: number;
  lon: number;
  deleted: number;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  received_at: number;
  acked_rev: number;
  ack_published: number;
};

const toPoint = (r: Row): MeetingPoint => ({
  groupId: r.group_id,
  id: r.id,
  rev: r.rev,
  name: r.name,
  note: r.note,
  lat: r.lat,
  lon: r.lon,
  deleted: r.deleted === 1,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  receivedAt: r.received_at,
  ackedRev: r.acked_rev,
  ackPublished: r.ack_published === 1,
});

type Version = Parameters<typeof mergePoint>[1];

/** Meeting points per group: the winning version of each, plus acknowledgments. */
export class MeetingPointsRepo {
  readonly changes = new Emitter<void>();

  constructor(private readonly db: DbPort) {}

  async get(groupId: string, id: string, db: DbReader = this.db): Promise<MeetingPoint | null> {
    const r = await db.get<Row>('SELECT * FROM meeting_points WHERE group_id = ? AND id = ?', [
      groupId,
      id,
    ]);
    return r ? toPoint(r) : null;
  }

  /** Live (not removed) points of one group, newest first. */
  async list(groupId: string): Promise<MeetingPoint[]> {
    const rows = await this.db.all<Row>(
      'SELECT * FROM meeting_points WHERE group_id = ? AND deleted = 0 ORDER BY updated_at DESC, id',
      [groupId],
    );
    return rows.map(toPoint);
  }

  /** Every group, tombstones included (used to answer sync requests). */
  async listAll(groupId: string): Promise<MeetingPoint[]> {
    const rows = await this.db.all<Row>(
      'SELECT * FROM meeting_points WHERE group_id = ? ORDER BY id',
      [groupId],
    );
    return rows.map(toPoint);
  }

  /** Live points of all groups that are still active on this device (what the map shows). */
  async listVisible(): Promise<MeetingPoint[]> {
    const rows = await this.db.all<Row>(
      `SELECT p.* FROM meeting_points p JOIN groups g ON g.id = p.group_id
       WHERE p.deleted = 0 AND g.status = 'active' ORDER BY p.updated_at DESC, p.id`,
    );
    return rows.map(toPoint);
  }

  /** Merge one version in a transaction. Resolves the stored point and whether it changed. */
  async apply(
    version: Version,
    receivedAt: number,
  ): Promise<{ point: MeetingPoint; changed: boolean }> {
    const out = await this.db.transaction(async tx => {
      const cur = await this.get(version.groupId, version.id, tx);
      const merged = mergePoint(cur, version, receivedAt);
      if (merged.changed) {
        const p = merged.next;
        await tx.run(
          `INSERT INTO meeting_points(group_id, id, rev, name, note, lat, lon, deleted, created_by,
             updated_by, created_at, updated_at, received_at, acked_rev, ack_published)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(group_id, id) DO UPDATE SET rev = excluded.rev, name = excluded.name,
             note = excluded.note, lat = excluded.lat, lon = excluded.lon,
             deleted = excluded.deleted, created_by = excluded.created_by,
             updated_by = excluded.updated_by, created_at = excluded.created_at,
             updated_at = excluded.updated_at, received_at = excluded.received_at`,
          [
            p.groupId,
            p.id,
            p.rev,
            p.name,
            p.note,
            p.lat,
            p.lon,
            p.deleted ? 1 : 0,
            p.createdBy,
            p.updatedBy,
            p.createdAt,
            p.updatedAt,
            p.receivedAt,
            p.ackedRev,
            p.ackPublished ? 1 : 0,
          ],
        );
      }
      return { point: merged.next, changed: merged.changed };
    });
    if (out.changed) {
      this.changes.emit();
    }
    return out;
  }

  // ---- acknowledgments --------------------------------------------------------------------

  /** This device acknowledges revision `rev` (not yet known to have reached the organizer). */
  async acknowledge(groupId: string, id: string, rev: number): Promise<void> {
    await this.db.run(
      `UPDATE meeting_points SET acked_rev = MAX(acked_rev, ?), ack_published = 0
       WHERE group_id = ? AND id = ? AND acked_rev < ?`,
      [rev, groupId, id, rev],
    );
    this.changes.emit();
  }

  async markAckPublished(groupId: string, id: string, rev: number): Promise<void> {
    await this.db.run(
      'UPDATE meeting_points SET ack_published = 1 WHERE group_id = ? AND id = ? AND acked_rev = ?',
      [groupId, id, rev],
    );
    this.changes.emit();
  }

  /** Points with an acknowledgment that has not reached the organizer yet. */
  async unpublishedAcks(groupId: string): Promise<MeetingPoint[]> {
    const rows = await this.db.all<Row>(
      `SELECT * FROM meeting_points WHERE group_id = ? AND deleted = 0 AND acked_rev > 0
       AND ack_published = 0`,
      [groupId],
    );
    return rows.map(toPoint);
  }

  /** Organizer: record a member's acknowledgment. Keeps the highest revision per member. */
  async recordAck(a: PointAck): Promise<boolean> {
    const changed = await this.db.transaction(async tx => {
      const cur = await tx.get<{ rev: number }>(
        'SELECT rev FROM point_acks WHERE group_id = ? AND point_id = ? AND address = ?',
        [a.groupId, a.pointId, a.address],
      );
      if (cur && cur.rev >= a.rev) {
        return false;
      }
      await tx.run(
        `INSERT INTO point_acks(group_id, point_id, address, rev, at) VALUES(?,?,?,?,?)
         ON CONFLICT(group_id, point_id, address) DO UPDATE SET rev = excluded.rev, at = excluded.at`,
        [a.groupId, a.pointId, a.address, a.rev, a.at],
      );
      return true;
    });
    if (changed) {
      this.changes.emit();
    }
    return changed;
  }

  async acks(groupId: string, pointId: string): Promise<PointAck[]> {
    const rows = await this.db.all<{
      group_id: string;
      point_id: string;
      address: string;
      rev: number;
      at: number;
    }>('SELECT * FROM point_acks WHERE group_id = ? AND point_id = ? ORDER BY at', [
      groupId,
      pointId,
    ]);
    return rows.map(r => ({
      groupId: r.group_id,
      pointId: r.point_id,
      address: r.address,
      rev: r.rev,
      at: r.at,
    }));
  }
}
