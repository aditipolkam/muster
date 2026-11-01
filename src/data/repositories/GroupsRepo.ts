import { Group, GroupMember, GroupRole, GroupStatus, MemberState } from '../../domain/groups/model';
import { mergeMember } from '../../domain/groups/merge';
import type { InviteRecord } from '../../domain/groups/invite';
import { DbPort, DbReader, DbTx } from '../DbPort';
import { Emitter } from '../events';

type GroupRow = {
  id: string;
  name: string;
  organizer: string;
  role: string;
  status: string;
  created_at: number;
  joined_at: number | null;
  member_rev: number;
};
type MemberRow = {
  group_id: string;
  address: string;
  name: string;
  role: string;
  state: string;
  rev: number;
  updated_at: number;
};
type InviteRow = {
  token_hash: string;
  group_id: string;
  expires_at: number;
  auto_approve: number;
  status: string;
  used_by: string | null;
};

const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  name: r.name,
  organizer: r.organizer,
  role: r.role as GroupRole,
  status: r.status as GroupStatus,
  createdAt: r.created_at,
  joinedAt: r.joined_at,
  memberRev: r.member_rev,
});
const toMember = (r: MemberRow): GroupMember => ({
  groupId: r.group_id,
  address: r.address,
  name: r.name,
  role: r.role as GroupRole,
  state: r.state as MemberState,
  rev: r.rev,
  updatedAt: r.updated_at,
});

export type InviteEntry = InviteRecord & { autoApprove: boolean };

/** Groups, their roster and (organizer only) invite tokens. */
export class GroupsRepo {
  readonly changes = new Emitter<void>();

  constructor(private readonly db: DbPort) {}

  async list(): Promise<Group[]> {
    const rows = await this.db.all<GroupRow>('SELECT * FROM groups ORDER BY created_at DESC, id');
    return rows.map(toGroup);
  }

  async get(id: string, db: DbReader = this.db): Promise<Group | null> {
    const row = await db.get<GroupRow>('SELECT * FROM groups WHERE id = ?', [id]);
    return row ? toGroup(row) : null;
  }

  async save(g: Group): Promise<void> {
    await this.db.run(
      `INSERT INTO groups(id, name, organizer, role, status, created_at, joined_at, member_rev)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, organizer = excluded.organizer,
         role = excluded.role, status = excluded.status, joined_at = excluded.joined_at,
         member_rev = excluded.member_rev`,
      [g.id, g.name, g.organizer, g.role, g.status, g.createdAt, g.joinedAt, g.memberRev],
    );
    this.changes.emit();
  }

  async setStatus(id: string, status: GroupStatus): Promise<void> {
    await this.db.run('UPDATE groups SET status = ? WHERE id = ?', [status, id]);
    this.changes.emit();
  }

  /** Removes the group and everything stored for it on this device. */
  async purge(id: string): Promise<void> {
    await this.db.transaction(async tx => {
      for (const t of ['group_members', 'group_invites', 'meeting_points', 'point_acks']) {
        await tx.run(`DELETE FROM ${t} WHERE group_id = ?`, [id]);
      }
      await tx.run('DELETE FROM groups WHERE id = ?', [id]);
    });
    this.changes.emit();
  }

  // ---- members ----------------------------------------------------------------------------

  async members(groupId: string, db: DbReader = this.db): Promise<GroupMember[]> {
    const rows = await db.all<MemberRow>(
      `SELECT * FROM group_members WHERE group_id = ?
       ORDER BY CASE role WHEN 'organizer' THEN 0 ELSE 1 END, updated_at, address`,
      [groupId],
    );
    return rows.map(toMember);
  }

  async member(groupId: string, address: string, db: DbReader = this.db) {
    const row = await db.get<MemberRow>(
      'SELECT * FROM group_members WHERE group_id = ? AND address = ?',
      [groupId, address],
    );
    return row ? toMember(row) : null;
  }

  /** Applies the merge rule inside one transaction. Resolves whether anything changed. */
  async applyMember(incoming: GroupMember): Promise<boolean> {
    const changed = await this.db.transaction(async tx => {
      const cur = await this.member(incoming.groupId, incoming.address, tx);
      const out = mergeMember(cur, incoming);
      if (out.changed) {
        await this.writeMember(tx, out.next);
        await tx.run('UPDATE groups SET member_rev = MAX(member_rev, ?) WHERE id = ?', [
          incoming.rev,
          incoming.groupId,
        ]);
      }
      return out.changed;
    });
    if (changed) {
      this.changes.emit();
    }
    return changed;
  }

  private writeMember(tx: DbTx, m: GroupMember): Promise<void> {
    return tx.run(
      `INSERT INTO group_members(group_id, address, name, role, state, rev, updated_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(group_id, address) DO UPDATE SET name = excluded.name, role = excluded.role,
         state = excluded.state, rev = excluded.rev, updated_at = excluded.updated_at`,
      [m.groupId, m.address, m.name, m.role, m.state, m.rev, m.updatedAt],
    );
  }

  /** Organizer: take the next member revision for the group. */
  async nextMemberRev(groupId: string): Promise<number> {
    const rev = await this.db.transaction(async tx => {
      await tx.run('UPDATE groups SET member_rev = member_rev + 1 WHERE id = ?', [groupId]);
      return Number(
        (await tx.get<{ r: number }>('SELECT member_rev AS r FROM groups WHERE id = ?', [groupId]))
          ?.r ?? 0,
      );
    });
    return rev;
  }

  // ---- invites (organizer) ----------------------------------------------------------------

  async saveInvite(
    hash: string,
    groupId: string,
    expiresAt: number,
    autoApprove: boolean,
    now: number,
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO group_invites(token_hash, group_id, expires_at, auto_approve, status, created_at)
       VALUES(?,?,?,?, 'open', ?)`,
      [hash, groupId, expiresAt, autoApprove ? 1 : 0, now],
    );
  }

  async invite(hash: string): Promise<InviteEntry | null> {
    const r = await this.db.get<InviteRow>('SELECT * FROM group_invites WHERE token_hash = ?', [
      hash,
    ]);
    return r
      ? {
          groupId: r.group_id,
          expiresAt: r.expires_at,
          status: r.status as InviteEntry['status'],
          usedBy: r.used_by,
          autoApprove: r.auto_approve === 1,
        }
      : null;
  }

  async markInviteUsed(hash: string, by: string): Promise<void> {
    await this.db.run(
      "UPDATE group_invites SET status = 'used', used_by = ? WHERE token_hash = ?",
      [by, hash],
    );
  }

  async revokeInvites(groupId: string): Promise<void> {
    await this.db.run(
      "UPDATE group_invites SET status = 'revoked' WHERE group_id = ? AND status = 'open'",
      [groupId],
    );
  }
}
