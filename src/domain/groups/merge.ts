import type { GroupMember, MeetingPoint, PointPayload, PointRemoved } from './model';

/**
 * Ordering of meeting point versions, MESH_PROTOCOL.md section 3.3: highest `rev` wins, a tie is
 * broken by the lexicographically greatest author. Independent of arrival order and of clocks.
 * Returns >0 when `a` beats `b`, <0 when `b` beats `a`, 0 when they are the same version.
 */
export function compareVersions(
  a: { rev: number; updatedBy: string },
  b: { rev: number; updatedBy: string },
): number {
  if (a.rev !== b.rev) {
    return a.rev - b.rev;
  }
  return a.updatedBy < b.updatedBy ? -1 : a.updatedBy > b.updatedBy ? 1 : 0;
}

export type MergeOutcome<T> = { next: T; changed: boolean };

type Version = Pick<
  MeetingPoint,
  | 'groupId'
  | 'id'
  | 'rev'
  | 'name'
  | 'note'
  | 'lat'
  | 'lon'
  | 'deleted'
  | 'createdBy'
  | 'updatedBy'
  | 'createdAt'
  | 'updatedAt'
>;

export function versionFromUpdate(groupId: string, p: PointPayload): Version {
  return {
    groupId,
    id: p.id,
    rev: p.rev,
    name: p.name,
    note: p.note ?? null,
    lat: p.lat,
    lon: p.lon,
    deleted: false,
    createdBy: p.createdBy,
    updatedBy: p.by,
    createdAt: p.createdAt,
    updatedAt: p.ts,
  };
}

/**
 * A removal is a tombstone version with a higher `rev`. If it arrives before the point it is
 * kept as a placeholder so that a late, older update cannot resurrect the point.
 */
export function versionFromRemoval(
  groupId: string,
  r: PointRemoved,
  existing: MeetingPoint | null,
): Version {
  return {
    groupId,
    id: r.id,
    rev: r.rev,
    name: existing?.name ?? '',
    note: existing?.note ?? null,
    lat: existing?.lat ?? 0,
    lon: existing?.lon ?? 0,
    deleted: true,
    createdBy: existing?.createdBy ?? r.by,
    updatedBy: r.by,
    createdAt: existing?.createdAt ?? r.ts,
    updatedAt: r.ts,
  };
}

/** Pure merge of one incoming version into the stored winner. Idempotent and commutative. */
export function mergePoint(
  current: MeetingPoint | null,
  incoming: Version,
  receivedAt: number,
): MergeOutcome<MeetingPoint> {
  if (current && compareVersions(incoming, current) <= 0) {
    return { next: current, changed: false };
  }
  return {
    changed: true,
    next: {
      ...incoming,
      receivedAt,
      // An acknowledgment applies to the revision that was acknowledged only.
      ackedRev: current?.ackedRev ?? 0,
      ackPublished: current?.ackPublished ?? false,
    },
  };
}

/** Next revision for an edit made here: one more than any version seen (Lamport style). */
export function nextRev(current: Pick<MeetingPoint, 'rev'> | null): number {
  return (current?.rev ?? 0) + 1;
}

/** Member events are issued by one writer (the organizer) so a higher `rev` per address wins. */
export function mergeMember(
  current: GroupMember | null,
  incoming: GroupMember,
): MergeOutcome<GroupMember> {
  if (current && incoming.rev <= current.rev) {
    return { next: current, changed: false };
  }
  return { next: incoming, changed: true };
}

/** Which of the organizer's points a requester is missing or has an older revision of. */
export function pointsToResend(
  mine: MeetingPoint[],
  theirs: { id: string; rev: number }[],
): MeetingPoint[] {
  const have = new Map(theirs.map(t => [t.id, t.rev]));
  return mine.filter(p => (have.get(p.id) ?? 0) < p.rev);
}
