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
  | 'sync';

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
    if ((kind === 'point' || kind === 'point_removed') && actor !== undefined && actor !== from) {
      return deny('meeting point author is not the organizer');
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
  return allow;
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
