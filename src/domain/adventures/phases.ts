import { distanceM, type LatLon } from '../geo';
import type { Checkpoint } from './model';
import { placeOf } from './model';

/** The slice of a phase the ordering rules need. */
type PhaseLike = Pick<Checkpoint, 'id' | 'ord' | 'deleted'>;

export type PhaseKind = 'place' | 'task' | 'place_task';

/** A phase is a place, a task, or both. Callers validate that it is at least one. */
export function phaseKind(c: Pick<Checkpoint, 'lat' | 'lon' | 'task'>): PhaseKind {
  const hasPlace = placeOf(c) !== null;
  const hasTask = c.task !== null && c.task.length > 0;
  if (hasPlace && hasTask) {
    return 'place_task';
  }
  return hasPlace ? 'place' : 'task';
}

/** Task-only phases cannot be verified by position; the person confirms them. */
export const needsSelfConfirmation = (c: Pick<Checkpoint, 'lat' | 'lon'>): boolean =>
  placeOf(c) === null;

const live = <T extends PhaseLike>(phases: T[]): T[] =>
  phases.filter(p => !p.deleted).sort((a, b) => a.ord - b.ord || (a.id < b.id ? -1 : 1));

/**
 * May this person complete `phaseId` now? Any-order activities always allow it. In an ordered
 * activity every earlier live phase must already be done by the same person. A removed or unknown
 * phase is never completable.
 */
export function isPhaseUnlocked(
  ordered: boolean,
  phases: PhaseLike[],
  doneIds: ReadonlySet<string>,
  phaseId: string,
): boolean {
  const list = live(phases);
  const idx = list.findIndex(p => p.id === phaseId);
  if (idx < 0) {
    return false;
  }
  if (!ordered) {
    return true;
  }
  return list.slice(0, idx).every(p => doneIds.has(p.id));
}

/** The first live phase this person has not done, or null when they are finished. */
export function nextPhase<T extends PhaseLike>(
  phases: T[],
  doneIds: ReadonlySet<string>,
): T | null {
  return live(phases).find(p => !doneIds.has(p.id)) ?? null;
}

export type PhaseProgress = { done: number; total: number; finished: boolean };

/** Finished means at least one phase exists and every live phase is done. */
export function phaseProgress(phases: PhaseLike[], doneIds: ReadonlySet<string>): PhaseProgress {
  const list = live(phases);
  const done = list.filter(p => doneIds.has(p.id)).length;
  return { done, total: list.length, finished: list.length > 0 && done === list.length };
}

export type ActivitySummary = {
  phases: number;
  /** Straight-line distance between the places in order, in metres; null with fewer than two. */
  distanceM: number | null;
  /** A walking-time range in minutes at 5 and 3 km/h; null when distanceM is. */
  minutes: [number, number] | null;
};

/**
 * What the organizer and participants see under an activity's name. The distance is the straight
 * line between phase places in order, not a walked route, so the screens say "about".
 */
export function summarizeActivity(
  phases: Pick<Checkpoint, 'lat' | 'lon' | 'ord' | 'deleted' | 'id'>[],
): ActivitySummary {
  const list = live(phases);
  const places = list.flatMap(p => placeOf(p) ?? []);
  let d = 0;
  for (let i = 1; i < places.length; i++) {
    d += distanceM(places[i - 1] as LatLon, places[i] as LatLon);
  }
  const hasRoute = places.length >= 2;
  return {
    phases: list.length,
    distanceM: hasRoute ? d : null,
    minutes: hasRoute ? [Math.round((d / 5000) * 60), Math.round((d / 3000) * 60)] : null,
  };
}

/** "2–3 hr", "45–70 min": a coarse range for a headline, never a promise. */
export function formatDurationRange([lo, hi]: [number, number]): string {
  const hr = (m: number) => Math.round((m / 60) * 2) / 2;
  if (hi < 90) {
    return `${Math.max(5, Math.round(lo / 5) * 5)}–${Math.max(10, Math.round(hi / 5) * 5)} min`;
  }
  const a = hr(lo);
  const b = hr(hi);
  return a === b ? `${a} hr` : `${a}–${b} hr`;
}

/** "118 MB", "850 KB". */
export function formatBytesShort(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${Math.round(bytes / 1_000_000)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export type PhaseStatus = 'done' | 'current' | 'open' | 'locked';

/**
 * Where each live phase stands for one person. The first phase they have not done is `current`.
 * After it, an ordered activity's phases are `locked`; an any-order activity's are `open`.
 */
export function phaseStatuses<T extends PhaseLike>(
  phases: T[],
  doneIds: ReadonlySet<string>,
  ordered: boolean,
): { phase: T; status: PhaseStatus }[] {
  const list = live(phases);
  const currentId = list.find(p => !doneIds.has(p.id))?.id;
  return list.map(phase => ({
    phase,
    status: doneIds.has(phase.id)
      ? 'done'
      : phase.id === currentId
      ? 'current'
      : ordered
      ? 'locked'
      : 'open',
  }));
}
