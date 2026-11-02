/**
 * Group topics, MESH_PROTOCOL.md section 2.3. Same grammar as `topics.ts`:
 * `tm/<v>/<groupId>/<channel>[/<detail>]`, charset `A-Z a-z 0-9 . _ - /`.
 *
 * The SDK has no mesh-wide topics, so every topic below belongs to ONE provider's service
 * (`GROUP_SERVICE_ID`). A device provides that service once for all its groups; the group id in
 * the topic is the scope. Patterns (`*`) are never used here: each channel is subscribed
 * explicitly, so nothing depends on wildcard behaviour being verified on devices.
 */
export const GROUP_SERVICE_ID = 'tm.group.1';
export const GROUP_SERVICE_VERSION = '1';

export const GroupChannel = {
  /** organizer -> members: roster events. member -> organizer: hello / leave. */
  member: 'member',
  /** organizer -> members: meeting point create/update. */
  point: 'point',
  /** organizer -> members: meeting point removal. */
  pointRemoved: 'point-removed',
  /** member -> organizer: acknowledgment of a meeting point. */
  ack: 'ack',
  /** member -> organizer: synchronisation request. */
  sync: 'sync',
  /** joiner subscribes to `j/<token>` as its join request; the organizer answers on it. */
  join: 'j',
  /**
   * Adventures. organizer -> members: adventure header, checkpoints, relayed arrivals and
   * participation, group milestones. member -> organizer: own arrivals, own participation, sync.
   * One topic per direction, several keys (`a-`, `c-`, `r-`, `p-`, `m-`, `sync`). Additive:
   * builds without adventures refuse the subscription and nothing else changes.
   */
  adv: 'adv',
} as const;

export type GroupChannelName = (typeof GroupChannel)[keyof typeof GroupChannel];

/** Channels an organizer publishes and members follow. */
export const ORGANIZER_CHANNELS = [
  GroupChannel.member,
  GroupChannel.point,
  GroupChannel.pointRemoved,
  GroupChannel.adv,
] as const;

/** Channels a member publishes and the organizer follows. */
export const MEMBER_CHANNELS = [
  GroupChannel.member,
  GroupChannel.ack,
  GroupChannel.sync,
  GroupChannel.adv,
] as const;

/** Nearby discovery: not group scoped, so it uses the reserved scope `beacon`. */
export const BEACON_TOPIC = 'tm/1/beacon';
/** Reserved token meaning "I found this group by nearby discovery"; always needs approval. */
export const NEARBY_TOKEN = 'open';

const ID = /^[A-Za-z0-9._-]{1,64}$/;

export function groupTopic(groupId: string, channel: GroupChannelName, detail?: string): string {
  const parts = ['tm', '1', groupId, channel, ...(detail ? [detail] : [])];
  if (!parts.every(p => ID.test(p))) {
    throw new Error('invalid group topic segment');
  }
  return parts.join('/');
}

export type ParsedGroupTopic =
  | { kind: 'beacon' }
  | { kind: 'group'; groupId: string; channel: string; detail: string | null };

export function parseGroupTopic(topic: string): ParsedGroupTopic | null {
  if (topic === BEACON_TOPIC) {
    return { kind: 'beacon' };
  }
  const parts = topic.split('/');
  if (parts.length < 4 || parts.length > 5 || parts[0] !== 'tm' || parts[1] !== '1') {
    return null;
  }
  const [, , groupId, channel, detail] = parts;
  if (!groupId || !channel || !ID.test(groupId) || !ID.test(channel)) {
    return null;
  }
  if (detail !== undefined && !ID.test(detail)) {
    return null;
  }
  return { kind: 'group', groupId, channel, detail: detail ?? null };
}
