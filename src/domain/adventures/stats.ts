import { elapsedMs } from './lifecycle';
import type {
  Adventure,
  AdventureStatus,
  Checkpoint,
  Completion,
  Participant,
  StatusLogEntry,
  TrackPoint,
} from './model';
import { thinRoute } from './track';

/** Individual progress is what this person did; group progress is what the joined people did. */
export type CheckpointStatus = {
  checkpoint: Checkpoint;
  mine: Completion | null;
  reachedBy: Completion[];
  /** Every joined participant has reached it. */
  everyone: boolean;
};

export function checkpointStatuses(
  checkpoints: Checkpoint[],
  completions: Completion[],
  participants: Participant[],
  me: string | null,
): CheckpointStatus[] {
  const joined = participants.filter(p => p.state === 'joined').map(p => p.address);
  return checkpoints
    .filter(c => !c.deleted)
    .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
    .map(checkpoint => {
      const reachedBy = completions
        .filter(x => x.checkpointId === checkpoint.id)
        .sort((a, b) => a.at - b.at);
      const mine = (me && reachedBy.find(x => x.address === me)) || null;
      return {
        checkpoint,
        mine,
        reachedBy,
        everyone: joined.length > 0 && joined.every(a => reachedBy.some(x => x.address === a)),
      };
    });
}

export type ProgressCounts = {
  total: number;
  mine: number;
  remaining: number;
  /** Checkpoints every joined participant has reached (equals `mine` for a solo adventure). */
  everyone: number;
  /** Checkpoints at least one other person reached. */
  byOthers: number;
};

export function progressCounts(statuses: CheckpointStatus[], me: string | null): ProgressCounts {
  const mine = statuses.filter(s => s.mine).length;
  return {
    total: statuses.length,
    mine,
    remaining: statuses.length - mine,
    everyone: statuses.filter(s => s.everyone).length,
    byOthers: statuses.filter(s => s.reachedBy.some(x => x.address !== me)).length,
  };
}

export const progressLabel = (c: ProgressCounts): string =>
  `${c.mine} of ${c.total} ${c.total === 1 ? 'checkpoint' : 'checkpoints'} explored`;

/** Next checkpoint to head for: the first one in order that this person has not reached. */
export function nextCheckpoint(statuses: CheckpointStatus[]): Checkpoint | null {
  return statuses.find(s => !s.mine)?.checkpoint ?? null;
}

// ---- qualifying -----------------------------------------------------------------------------

export const QUALIFY_MIN_ACTIVE_MS = 20 * 60_000;
export const QUALIFY_MIN_DISTANCE_M = 300;

/**
 * Does a finished adventure count towards milestones? Pressing Start then Finish must not. It
 * counts when this person reached a checkpoint, or really spent time moving. Distance by itself
 * is never a reward; here it is only a gate against an empty trip.
 */
export function qualifies(input: {
  myCheckpoints: number;
  activeMs: number;
  distanceM: number;
}): boolean {
  return (
    input.myCheckpoints >= 1 ||
    (input.activeMs >= QUALIFY_MIN_ACTIVE_MS && input.distanceM >= QUALIFY_MIN_DISTANCE_M)
  );
}

// ---- timeline ---------------------------------------------------------------------------------

export type TimelineEntry = {
  key: string;
  kind: 'created' | 'status' | 'joined' | 'left' | 'reached' | 'all_reached';
  at: number;
  address?: string;
  status?: AdventureStatus;
  checkpointId?: string;
  method?: 'auto' | 'manual';
  /** The arrival came from an organizer relay and has not been seen first-hand. */
  relayed?: boolean;
};

/**
 * One shared timeline built only from stored state, so every device that has the same state
 * shows the same list and a missed message just means a shorter one.
 */
export function buildTimeline(input: {
  adventure: Adventure;
  log: StatusLogEntry[];
  completions: Completion[];
  participants: Participant[];
  checkpoints: Checkpoint[];
  me: string | null;
}): TimelineEntry[] {
  const { adventure, log, completions, participants, checkpoints, me } = input;
  const out: TimelineEntry[] = [
    { key: 'created', kind: 'created', at: adventure.createdAt },
    ...log.map(
      (l): TimelineEntry => ({
        key: `status:${l.rev}`,
        kind: 'status',
        at: l.at,
        status: l.status,
      }),
    ),
    ...participants.map(
      (p): TimelineEntry => ({
        key: `p:${p.address}:${p.seq}`,
        kind: p.state === 'joined' ? 'joined' : 'left',
        at: p.updatedAt,
        address: p.address,
      }),
    ),
    ...completions.map(
      (x): TimelineEntry => ({
        key: `r:${x.checkpointId}:${x.address}`,
        kind: 'reached',
        at: x.at,
        address: x.address,
        checkpointId: x.checkpointId,
        method: x.method,
        relayed: x.address !== me,
      }),
    ),
  ];
  const statuses = checkpointStatuses(checkpoints, completions, participants, me);
  for (const s of statuses) {
    if (s.everyone && s.reachedBy.length > 1) {
      const last = s.reachedBy[s.reachedBy.length - 1] as Completion;
      out.push({
        key: `all:${s.checkpoint.id}`,
        kind: 'all_reached',
        at: last.at,
        checkpointId: s.checkpoint.id,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

// ---- recap ---------------------------------------------------------------------------------------

export type Recap = {
  name: string;
  startedAt: number | null;
  endedAt: number | null;
  status: AdventureStatus;
  durationMs: number;
  /** Null when nothing was recorded; never an estimate. */
  distanceM: number | null;
  checkpointsDone: { checkpoint: Checkpoint; at: number; method: 'auto' | 'manual' }[];
  checkpointsTotal: number;
  participants: { address: string; name: string }[];
  groupExplored: number | null;
  route: TrackPoint[];
  unlockedIds: string[];
  isGroup: boolean;
};

export function buildRecap(input: {
  adventure: Adventure;
  checkpoints: Checkpoint[];
  completions: Completion[];
  participants: Participant[];
  track: TrackPoint[];
  unlockedIds: string[];
  me: string | null;
  now: number;
}): Recap {
  const { adventure: a, track } = input;
  const statuses = checkpointStatuses(
    input.checkpoints,
    input.completions,
    input.participants,
    input.me,
  );
  const counts = progressCounts(statuses, input.me);
  const hasRoute = track.length >= 2;
  const distance = a.progress.distanceM;
  return {
    name: a.name,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    status: a.status,
    durationMs: elapsedMs(a.progress, a.endedAt ?? input.now),
    distanceM: hasRoute || distance > 0 ? distance : null,
    checkpointsDone: statuses
      .filter(s => s.mine)
      .map(s => ({
        checkpoint: s.checkpoint,
        at: (s.mine as Completion).at,
        method: (s.mine as Completion).method,
      })),
    checkpointsTotal: counts.total,
    participants: input.participants
      .filter(p => p.state === 'joined')
      .map(p => ({ address: p.address, name: p.name })),
    groupExplored: a.groupId ? counts.everyone : null,
    route: hasRoute ? thinRoute(track, 150) : [],
    unlockedIds: input.unlockedIds,
    isGroup: a.groupId !== null,
  };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) {
    return `${m} min`;
  }
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** `H:MM:SS` (or `M:SS`) for a running clock. */
export function formatClock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
