import { z } from 'zod';
import { isValidLatLon } from '../geo';

export const ADVENTURE_NAME_MAX = 60;
export const ADVENTURE_DESC_MAX = 200;
export const CHECKPOINT_NAME_MAX = 60;
export const CHECKPOINT_DESC_MAX = 140;
export const MAX_CHECKPOINTS = 20;
/** Bounds what a relay or a hostile peer can make this device store per adventure. */
export const MAX_COMPLETIONS_PER_ADVENTURE = MAX_CHECKPOINTS * 12;
export const MAX_SYNC_ADVENTURES = 6;

/** Planned -> Active <-> Paused -> Completed, with Cancelled reachable from any non-final state. */
export type AdventureStatus = 'planned' | 'active' | 'paused' | 'completed' | 'cancelled';
export const ADVENTURE_STATUSES: AdventureStatus[] = [
  'planned',
  'active',
  'paused',
  'completed',
  'cancelled',
];

/** The checkpoint "icon" is its kind: one small, consistent set instead of free-form pictures. */
export type CheckpointKind =
  | 'entrance'
  | 'viewpoint'
  | 'waterfall'
  | 'campsite'
  | 'rest'
  | 'summit'
  | 'destination'
  | 'other';

export const CHECKPOINT_KINDS: { kind: CheckpointKind; label: string }[] = [
  { kind: 'entrance', label: 'Trail entrance' },
  { kind: 'viewpoint', label: 'Viewpoint' },
  { kind: 'waterfall', label: 'Waterfall' },
  { kind: 'campsite', label: 'Campsite' },
  { kind: 'rest', label: 'Rest stop' },
  { kind: 'summit', label: 'Summit' },
  { kind: 'destination', label: 'Final destination' },
  { kind: 'other', label: 'Other' },
];

export const kindLabel = (k: CheckpointKind): string =>
  CHECKPOINT_KINDS.find(x => x.kind === k)?.label ?? 'Other';

export type ArrivalMethod = 'auto' | 'manual';
export type ParticipantState = 'joined' | 'left';

/** What the person doing the adventure has recorded on this device. Never published as-is. */
export type PersonalProgress = {
  /** Start of the current running segment (running = active and joined); null otherwise. */
  resumedAt: number | null;
  /** Milliseconds of closed running segments. Rest and pauses never count against anyone. */
  activeMs: number;
  distanceM: number;
  /** Whether the adventure's places were inside downloaded regions; decided once at completion. */
  offlineMapsCovered: boolean | null;
  /** Set when app code used the network while the adventure was running. */
  networkUsed: boolean;
  /** First time an authenticated group member's message reached this device during the adventure. */
  meshExchangeAt: number | null;
};

export type Adventure = {
  id: string;
  /** Null for a solo adventure (nothing is ever sent to the mesh). */
  groupId: string | null;
  /** Authority for the shared state: the group organizer, or this device for a solo adventure. */
  owner: string | null;
  name: string;
  description: string | null;
  status: AdventureStatus;
  /** Bumped by the owner on every shared change; the highest wins. */
  rev: number;
  startLat: number | null;
  startLon: number | null;
  startLabel: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Minutes behind UTC when the adventure ended (Date#getTimezoneOffset), for weekend logic. */
  tzOffsetMin: number;
  progress: PersonalProgress;
};

export type Checkpoint = {
  adventureId: string;
  id: string;
  rev: number;
  ord: number;
  name: string;
  description: string | null;
  kind: CheckpointKind;
  lat: number;
  lon: number;
  deleted: boolean;
};

export type Completion = {
  adventureId: string;
  checkpointId: string;
  address: string;
  /** Completion id (ULID) chosen by the person who arrived; also the pub/sub key. */
  id: string;
  at: number;
  method: ArrivalMethod;
  /** Whether it reached the group's owner (only meaningful for the local member's own rows). */
  published: boolean;
  receivedAt: number;
};

export type Participant = {
  adventureId: string;
  address: string;
  name: string;
  state: ParticipantState;
  /** Per-participant counter, bumped only by that participant; highest wins. */
  seq: number;
  /** Stable id used as the pub/sub key for this participant's state. */
  pid: string;
  updatedAt: number;
  published: boolean;
};

export type StatusLogEntry = {
  adventureId: string;
  rev: number;
  status: AdventureStatus;
  at: number;
};

export type TrackPoint = { lat: number; lon: number; at: number; accM: number };

// ---- input validation ---------------------------------------------------------------------------

const latLon = {
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
};

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform(v => (v && v.length > 0 ? v : null));

export const AdventureInputSchema = z.object({
  name: trimmed(ADVENTURE_NAME_MAX),
  description: optionalText(ADVENTURE_DESC_MAX),
  start: z
    .object({
      ...latLon,
      label: optionalText(60),
    })
    .nullish()
    .refine(s => !s || isValidLatLon(s.lat, s.lon)),
});
export type AdventureInput = z.input<typeof AdventureInputSchema>;

export const CheckpointInputSchema = z.object({
  name: trimmed(CHECKPOINT_NAME_MAX),
  description: optionalText(CHECKPOINT_DESC_MAX),
  kind: z.enum([
    'entrance',
    'viewpoint',
    'waterfall',
    'campsite',
    'rest',
    'summit',
    'destination',
    'other',
  ]),
  ...latLon,
});
export type CheckpointInput = z.input<typeof CheckpointInputSchema>;

// ---- wire payloads (MESH_PROTOCOL.md "Adventures") ---------------------------------------------

const idStr = z.string().min(1).max(64);
const ts = z.number().int().nonnegative();

export const AdventureHeaderSchema = z.object({
  id: idStr,
  rev: z.number().int().min(1),
  name: z
    .string()
    .min(1)
    .max(ADVENTURE_NAME_MAX * 2),
  desc: z
    .string()
    .max(ADVENTURE_DESC_MAX * 2)
    .nullish(),
  status: z.enum(['planned', 'active', 'paused', 'completed', 'cancelled']),
  st: z.object({ lat: latLon.lat, lon: latLon.lon, n: z.string().max(120).nullish() }).nullish(),
  ca: ts,
  sa: ts.nullish(),
  ea: ts.nullish(),
  /** Owner clock at the transition; used only to clamp personal segments. */
  ts,
});
export type AdventureHeader = z.infer<typeof AdventureHeaderSchema>;

export const CheckpointWireSchema = z.object({
  adv: idStr,
  id: idStr,
  rev: z.number().int().min(1),
  ord: z.number().int().min(0).max(1000),
  name: z
    .string()
    .min(1)
    .max(CHECKPOINT_NAME_MAX * 2),
  desc: z
    .string()
    .max(CHECKPOINT_DESC_MAX * 2)
    .nullish(),
  kind: z.enum([
    'entrance',
    'viewpoint',
    'waterfall',
    'campsite',
    'rest',
    'summit',
    'destination',
    'other',
  ]),
  lat: latLon.lat,
  lon: latLon.lon,
  del: z.boolean().optional(),
  ts,
});
export type CheckpointWire = z.infer<typeof CheckpointWireSchema>;

/** A person reached a checkpoint. Carries no position: only which checkpoint and when. */
export const ReachedSchema = z.object({
  adv: idStr,
  cp: idStr,
  id: idStr,
  at: ts,
  m: z.enum(['auto', 'manual']),
  /** Present only when the owner relays someone else's arrival. */
  addr: z.string().min(1).max(200).optional(),
});
export type ReachedWire = z.infer<typeof ReachedSchema>;

export const ParticipantSchema = z.object({
  adv: idStr,
  pid: idStr,
  state: z.enum(['joined', 'left']),
  seq: z.number().int().min(1),
  ts,
  addr: z.string().min(1).max(200).optional(),
  name: z.string().max(40).optional(),
});
export type ParticipantWire = z.infer<typeof ParticipantSchema>;

export const MilestoneSchema = z.object({
  adv: idStr,
  key: z.literal('all_reached'),
  cp: idStr,
  ts,
});
export type MilestoneWire = z.infer<typeof MilestoneSchema>;

export const AdvSyncSchema = z.object({
  advs: z
    .array(z.object({ id: idStr, rev: z.number().int().min(0), cc: z.number().int().min(0) }))
    .max(MAX_SYNC_ADVENTURES),
});
export type AdvSyncWire = z.infer<typeof AdvSyncSchema>;

/** Stands in for this device's address in solo adventures, which never touch the mesh. */
export const SOLO_ADDRESS = 'local';
