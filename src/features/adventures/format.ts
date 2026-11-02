import type { AdventureStatus, CheckpointKind } from '../../domain/adventures/model';
import type { IconName } from '../../ui/components';

export const STATUS_LABEL: Record<AdventureStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<AdventureStatus, 'neutral' | 'good' | 'warn' | 'bad'> = {
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
  'A checkpoint is only a place you chose. TrailMesh does not know about closures, private land, weather or terrain. Pick safe, public, accessible places, stay on marked paths and turn back if conditions change.';
