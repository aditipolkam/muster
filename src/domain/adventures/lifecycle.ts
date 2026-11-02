import type { AdventureStatus, PersonalProgress } from './model';

export type AdventureAction = 'start' | 'pause' | 'resume' | 'complete' | 'cancel';

const TABLE: Record<AdventureStatus, Partial<Record<AdventureAction, AdventureStatus>>> = {
  planned: { start: 'active', cancel: 'cancelled' },
  active: { pause: 'paused', complete: 'completed', cancel: 'cancelled' },
  paused: { resume: 'active', complete: 'completed', cancel: 'cancelled' },
  completed: {},
  cancelled: {},
};

/** The next status for a local action, or null when the action is not allowed from `from`. */
export function transition(from: AdventureStatus, action: AdventureAction): AdventureStatus | null {
  return TABLE[from][action] ?? null;
}

export const isFinal = (s: AdventureStatus): boolean => s === 'completed' || s === 'cancelled';

export function actionsFor(s: AdventureStatus): AdventureAction[] {
  return Object.keys(TABLE[s]) as AdventureAction[];
}

const RANK: Record<AdventureStatus, number> = {
  planned: 0,
  active: 1,
  paused: 1,
  completed: 2,
  cancelled: 2,
};

/**
 * May a status received from the owner replace `from`? The owner is the single writer, so the
 * revision decides order; this check only refuses what no sequence of legal actions can produce.
 * A receiver can miss revisions (planned -> paused with the "active" one lost), so any forward
 * move is accepted; a final status never changes; nothing goes back to planned.
 */
export function isAcceptableRemoteStatus(from: AdventureStatus, to: AdventureStatus): boolean {
  if (from === to) {
    return true;
  }
  if (isFinal(from)) {
    return false;
  }
  if (to === 'planned') {
    return false;
  }
  return RANK[to] >= RANK[from];
}

/** Running means the clock is ticking for this person: the adventure is active and they joined. */
export const isRunning = (status: AdventureStatus, joined: boolean): boolean =>
  status === 'active' && joined;

/**
 * Open or close the personal running segment when status or participation changes.
 * `at` must already be clamped by the caller (never before `resumedAt`, never in the future).
 */
export function advanceProgress(
  p: PersonalProgress,
  wasRunning: boolean,
  nowRunning: boolean,
  at: number,
): PersonalProgress {
  if (!wasRunning && nowRunning) {
    return { ...p, resumedAt: at };
  }
  if (wasRunning && !nowRunning) {
    const closed = p.resumedAt === null ? 0 : Math.max(0, at - p.resumedAt);
    return { ...p, activeMs: p.activeMs + closed, resumedAt: null };
  }
  return p;
}

export function elapsedMs(p: PersonalProgress, now: number): number {
  return p.activeMs + (p.resumedAt === null ? 0 : Math.max(0, now - p.resumedAt));
}
