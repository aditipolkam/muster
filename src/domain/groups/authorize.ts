import type { Group, GroupMember } from './model';

export type InboundKind =
  /** organizer -> members */
  | 'member_event'
  | 'point'
  | 'point_removed'
  | 'welcome'
  /** member -> organizer */
  | 'hello'
  | 'leave'
  | 'ack'
  | 'sync'
  /** co-leader -> organizer: a proposed meeting point change (ADR 0016) */
  | 'point_edit';

export type Decision = { ok: true } | { ok: false; reason: string };

const deny = (reason: string): Decision => ({ ok: false, reason });
const allow: Decision = { ok: true };

/**
 * Who may publish what, MESH_PROTOCOL.md section 2.3. Pure; the caller supplies the local
 * persisted state.
 *
 * `from` is the SDK's `provider` field: the 1:1 session peer that sent the update. It is the only
 * identity trusted. The envelope's own `a` is informational and must merely agree with it.
 *
 * - Group state (roster, meeting points, welcome) is accepted only from the group's organizer,
 *   as recorded when this device created or joined the group.
 * - Member messages (hello, leave, ack, sync) are accepted only by the organizer, only from an
 *   active roster member.
 * - A meeting point may name a co-leader as its author (`by`): the organizer relayed their edit.
 *   It still has to come from the organizer, and the author has to be in the roster.
 * - A proposed point edit is accepted only by the organizer, only from an active co-leader who
 *   names themselves as the author.
 */
export function authorizeInbound(input: {
  kind: InboundKind;
  group: Group | null;
  members: GroupMember[];
  from: string;
  /** Author address claimed inside the envelope (`a`). */
  claimedAuthor: string;
  /** Address the payload claims to act for, when it names one (e.g. `by`, `addr`). */
  actor?: string;
}): Decision {
  const { kind, group, members, from, claimedAuthor, actor } = input;
  if (!group) {
    return deny('unknown group');
  }
  if (claimedAuthor !== from) {
    return deny('envelope author does not match the sender');
  }
  const organizerKinds: InboundKind[] = ['member_event', 'point', 'point_removed', 'welcome'];
  if (organizerKinds.includes(kind)) {
    if (group.role === 'organizer') {
      return deny('this device is the organizer');
    }
    if (from !== group.organizer) {
      return deny('sender is not the group organizer');
    }
    if (kind === 'welcome') {
      return group.status === 'joining' ? allow : deny('not waiting for a welcome');
    }
    if (group.status !== 'active') {
      return deny(`group is ${group.status}`);
    }
    if (
      (kind === 'point' || kind === 'point_removed') &&
      actor !== undefined &&
      !isPlanAuthor(group, members, actor)
    ) {
      return deny('meeting point author is not the organizer or a group leader');
    }
    return allow;
  }
  if (group.role !== 'organizer') {
    return deny('only the organizer accepts member messages');
  }
  if (group.status !== 'active') {
    return deny(`group is ${group.status}`);
  }
  const member = members.find(m => m.address === from);
  if (!member || member.state !== 'active') {
    return deny('sender is not an active member');
  }
  if ((kind === 'hello' || kind === 'leave') && actor !== undefined && actor !== from) {
    return deny('member message names someone else');
  }
  if (kind === 'point_edit') {
    if (member.role !== 'leader') {
      return deny('sender is not a group leader');
    }
    if (actor !== from) {
      return deny('proposed edit names someone else as its author');
    }
  }
  return allow;
}

/**
 * May `address` be named as the author of a meeting point version this device received from the
 * organizer? The organizer itself, or anyone in the roster: a co-leader can be demoted or leave
 * later, and the versions they wrote stay valid.
 */
export function isPlanAuthor(group: Group, members: GroupMember[], address: string): boolean {
  return address === group.organizer || members.some(m => m.address === address);
}

/** May this device publish meeting points for the group? Only the organizer. */
export function canPublishPoints(group: Group | null, localAddress: string | null): boolean {
  return (
    !!group &&
    !!localAddress &&
    group.role === 'organizer' &&
    group.status === 'active' &&
    group.organizer === localAddress
  );
}

/**
 * May this device edit the group's plan (meeting points, adventure checkpoints)? The organizer,
 * or an active co-leader (ADR 0016), whose edits go to the organizer to be shared.
 */
export function canEditPlan(
  group: Group | null,
  members: GroupMember[],
  localAddress: string | null,
): boolean {
  if (canPublishPoints(group, localAddress)) {
    return true;
  }
  return (
    !!group &&
    group.role === 'member' &&
    group.status === 'active' &&
    members.some(m => m.address === localAddress && m.state === 'active' && m.role === 'leader')
  );
}

/**
 * Decide an incoming subscription request to this device's group service
 * (the SDK delivers it as `service_subscribe_received` under the `restricted` policy).
 * `join` is handled separately because it needs an invite lookup.
 */
export function authorizeSubscription(input: {
  channel: string;
  group: Group | null;
  members: GroupMember[];
  sender: string;
}): Decision {
  const { channel, group, members, sender } = input;
  if (!group) {
    return deny('unknown group');
  }
  if (group.role === 'organizer') {
    if (group.status !== 'active') {
      return deny('group is not active');
    }
    const organizerChannels = ['member', 'point', 'point-removed', 'adv'];
    if (!organizerChannels.includes(channel)) {
      return deny('channel is not published by the organizer');
    }
    const m = members.find(x => x.address === sender);
    return m && m.state === 'active' ? allow : deny('requester is not an active member');
  }
  const memberChannels = ['member', 'ack', 'sync', 'adv'];
  if (!memberChannels.includes(channel)) {
    return deny('channel is not published by members');
  }
  return sender === group.organizer && group.status !== 'closed'
    ? allow
    : deny('only the organizer may follow a member');
}
