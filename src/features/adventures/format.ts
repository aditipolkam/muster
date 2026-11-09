import { Checkpoint, kindLabel } from '../../domain/adventures/model';
import type { AdventureStatus, CheckpointKind, PhaseType } from '../../domain/adventures/model';
import type { TimelineEntry } from '../../domain/adventures/stats';
import { phaseKind } from '../../domain/adventures/phases';
import type { IconName } from '../../ui/components';

export const STATUS_LABEL: Record<AdventureStatus, string> = {
  draft: 'Draft',
  planned: 'Planned',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<AdventureStatus, 'neutral' | 'good' | 'warn' | 'bad'> = {
  draft: 'neutral',
  planned: 'neutral',
  active: 'good',
  paused: 'warn',
  completed: 'neutral',
  cancelled: 'neutral',
};

/** The checkpoint "icon" is chosen from the existing glyph set, one per kind. */
export const KIND_ICON: Record<CheckpointKind, IconName> = {
  entrance: 'trail',
  viewpoint: 'locate',
  waterfall: 'layers',
  campsite: 'pin',
  rest: 'pin',
  summit: 'flag',
  destination: 'flag',
  other: 'pin',
};

export const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export const SAFETY_NOTE =
  'A checkpoint is only a place you chose. Muster does not know about closures, private land, weather or terrain. Pick safe, public, accessible places, stay on marked paths and turn back if conditions change.';

export const PHASE_ICON: Record<PhaseType, IconName> = {
  checkpoint: 'pin',
  collect: 'flower',
  photo: 'camera',
  task: 'list',
};

/** One line about a phase for lists: the place kind, the task, or both. */
export function phaseSummary(c: Pick<Checkpoint, 'kind' | 'lat' | 'lon' | 'task'>): string {
  switch (phaseKind(c)) {
    case 'place':
      return kindLabel(c.kind);
    case 'task':
      return c.task ?? 'Task';
    default:
      return `${kindLabel(c.kind)} · ${c.task}`;
  }
}

export function timelineText(
  e: TimelineEntry,
  nameOf: (addr: string) => string,
  cps: { id: string; name: string }[],
): string {
  const cp = cps.find(c => c.id === e.checkpointId)?.name ?? 'a checkpoint';
  switch (e.kind) {
    case 'created':
      return 'Adventure planned';
    case 'status':
      return `Adventure ${e.status === 'active' ? 'started or resumed' : e.status}`;
    case 'joined':
      return `${nameOf(e.address ?? '')} joined`;
    case 'left':
      return `${nameOf(e.address ?? '')} left`;
    case 'finished':
      return `${nameOf(e.address ?? '')} finished`;
    case 'reached':
      return `${nameOf(e.address ?? '')} reached ${cp}`;
    case 'all_reached':
      return `Everyone has reached ${cp}`;
  }
}
