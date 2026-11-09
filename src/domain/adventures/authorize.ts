import type { Group, GroupMember } from '../groups/model';
import type { AdventureStatus, ParticipantState } from './model';
import { isPhaseUnlocked } from './phases';

export type AdventureInboundKind =
  /** owner -> members */
  | 'adventure'
  | 'checkpoint'
  | 'relay_reached'
  | 'relay_participant'
  | 'milestone'
  /** member -> owner */
  | 'reached'
  | 'participant'
  | 'adv_sync';

export type Decision = { ok: true } | { ok: false; reason: string };

const deny = (reason: string): Decision => ({ ok: false, reason });
const allow: Decision = { ok: true };

const OWNER_KINDS: AdventureInboundKind[] = [
  'adventure',
  'checkpoint',
  'relay_reached',
  'relay_participant',
  'milestone',
];

/** What this device knows locally about the adventure a message refers to. */
export type KnownAdventure = {
  groupId: string | null;
  owner: string | null;
  status: AdventureStatus;
  /** Checkpoint ids the owner has published and not removed. */
  liveCheckpointIds: string[];
  /** The sender's recorded participation, if any. */
  senderState: ParticipantState | null;
  /** Ordered activity: ids of the phases the sender has already completed. */
  senderDoneCheckpointIds?: string[];
  /** Ordered activity: phases are live, in order, as the organizer published them. */
  ordered?: boolean;
  liveCheckpoints?: { id: string; ord: number }[];
};

/**
 * Who may publish what on the `adv` channel. Same trust model as meeting points
 * (MESH_PROTOCOL.md 2.3): the SDK `provider` is the only identity trusted, the envelope `a` must
 * match it, shared adventure state is accepted only from the group's organizer as recorded when
 * this device created or joined the group, and member messages only by the organizer from an
 * active roster member who names themselves.
 */
export function authorizeAdventureInbound(input: {
  kind: AdventureInboundKind;
  group: Group | null;
  members: GroupMember[];
  from: string;
  claimedAuthor: string;
  /** The address a payload says it acts for (`addr`), when present. */
  actor?: string;
  /** For member -> owner messages that point at one adventure. */
  adventure?: KnownAdventure | null;
  checkpointId?: string;
}): Decision {
  const { kind, group, members, from, claimedAuthor, actor, adventure } = input;
  if (!group) {
    return deny('unknown group');
  }
  if (claimedAuthor !== from) {
    return deny('envelope author does not match the sender');
  }
  if (group.status !== 'active') {
    return deny(`group is ${group.status}`);
  }
  if (OWNER_KINDS.includes(kind)) {
    if (group.role === 'organizer') {
      return deny('this device is the organizer');
    }
    if (from !== group.organizer) {
      return deny('sender is not the group organizer');
    }
    if ((kind === 'relay_reached' || kind === 'relay_participant') && !actor) {
      return deny('relayed message does not say whose it is');
    }
    return allow;
  }
  if (group.role !== 'organizer') {
    return deny('only the organizer accepts member messages');
  }
  const member = members.find(m => m.address === from);
  if (!member || member.state !== 'active') {
    return deny('sender is not an active member');
  }
  if (actor !== undefined && actor !== from) {
    return deny('member message names someone else');
  }
  if (kind === 'adv_sync') {
    return allow;
  }
  if (!adventure || adventure.groupId !== group.id || adventure.owner !== group.organizer) {
    return deny('unknown adventure for this group');
  }
  if (kind === 'participant') {
    return adventure.status === 'draft' ||
      adventure.status === 'cancelled' ||
      adventure.status === 'completed'
      ? deny(`adventure is ${adventure.status}`)
      : allow;
  }
  // reached
  if (
    adventure.status === 'draft' ||
    adventure.status === 'planned' ||
    adventure.status === 'cancelled'
  ) {
    return deny(`adventure is ${adventure.status}`);
  }
  if (adventure.senderState === 'left') {
    return deny('sender left this adventure');
  }
  if (!input.checkpointId || !adventure.liveCheckpointIds.includes(input.checkpointId)) {
    return deny('unknown checkpoint');
  }
  // Ordered activities: an arrival that overtakes its predecessor is refused now and accepted on
  // the member's retry once the earlier one has arrived (unconfirmed arrivals are re-sent).
  if (
    adventure.ordered &&
    !isPhaseUnlocked(
      true,
      (adventure.liveCheckpoints ?? []).map(c => ({ ...c, deleted: false })),
      new Set(adventure.senderDoneCheckpointIds ?? []),
      input.checkpointId,
    )
  ) {
    return deny('an earlier phase is not done yet');
  }
  return allow;
}

/** Only the group organizer plans a group adventure; everyone can plan their own. */
export function canPlanGroupAdventure(group: Group | null, me: string | null): boolean {
  return (
    !!group &&
    !!me &&
    group.role === 'organizer' &&
    group.status === 'active' &&
    group.organizer === me
  );
}

/** May this device change the shared state (lifecycle, checkpoints) of the adventure? */
export function canEditAdventure(
  adv: { groupId: string | null; owner: string | null },
  group: Group | null,
  me: string | null,
): boolean {
  if (adv.groupId === null) {
    return adv.owner === null || adv.owner === me;
  }
  return canPlanGroupAdventure(group, me) && adv.owner === me;
}
