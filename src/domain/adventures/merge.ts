import { isAcceptableRemoteStatus } from './lifecycle';
import type {
  AdventureHeader,
  AdventureStatus,
  Checkpoint,
  Completion,
  Participant,
} from './model';

/**
 * Merge rules for replicated adventure state. All of them are commutative and idempotent, so the
 * result never depends on arrival order and a repeated message is a no-op.
 */

export type HeaderVerdict =
  | { accept: true }
  | { accept: false; reason: 'stale' | 'illegal_transition' | 'wrong_group' };

/**
 * The owner is the only writer of the shared header, so the highest `rev` wins. Equal or lower
 * revisions are stale. A higher revision is still refused when it asks for something no legal
 * sequence of owner actions can produce (e.g. leaving a final status): conflicting states are
 * never blindly merged.
 */
export function judgeHeader(
  cur: { rev: number; status: AdventureStatus; groupId: string | null } | null,
  incoming: AdventureHeader,
  groupId: string,
): HeaderVerdict {
  if (!cur) {
    return { accept: true };
  }
  if (cur.groupId !== groupId) {
    return { accept: false, reason: 'wrong_group' };
  }
  if (incoming.rev <= cur.rev) {
    return { accept: false, reason: 'stale' };
  }
  if (!isAcceptableRemoteStatus(cur.status, incoming.status)) {
    return { accept: false, reason: 'illegal_transition' };
  }
  return { accept: true };
}

/** Highest revision wins; a tombstone is a version like any other. */
export function mergeCheckpoint(
  cur: Pick<Checkpoint, 'rev'> | null,
  incoming: Pick<Checkpoint, 'rev'>,
): boolean {
  return !cur || incoming.rev > cur.rev;
}

/**
 * Completions only ever grow. If the same person reports the same checkpoint twice (a retry, or a
 * relay of the same arrival) the earliest report wins, ties broken by the smaller id.
 */
export function mergeCompletion(
  cur: Pick<Completion, 'at' | 'id'> | null,
  incoming: Pick<Completion, 'at' | 'id'>,
): boolean {
  if (!cur) {
    return true;
  }
  if (incoming.at !== cur.at) {
    return incoming.at < cur.at;
  }
  return incoming.id < cur.id;
}

/** Only the participant bumps `seq`, so the highest `seq` is that participant's latest word. */
export function mergeParticipant(
  cur: Pick<Participant, 'seq'> | null,
  incoming: Pick<Participant, 'seq'>,
): boolean {
  return !cur || incoming.seq > cur.seq;
}
