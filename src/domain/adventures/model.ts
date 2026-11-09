import { z } from 'zod';
import { isValidLatLon } from '../geo';
import { MAX_AREA_SPAN_DEG, MapArea, MapAreaWireSchema } from '../maps/mapArea';

// The map area moved to domain/maps (a group's trip map uses it too); re-exported for callers.
export {
  MAP_AREA_NAME_MAX,
  MAX_AREA_SPAN_DEG,
  MAX_AREA_ZOOM,
  MapAreaWireSchema,
  toMapArea,
  toMapAreaWire,
} from '../maps/mapArea';
export type { MapArea, MapAreaWire } from '../maps/mapArea';

export const ADVENTURE_NAME_MAX = 60;
export const ADVENTURE_DESC_MAX = 200;
export const CHECKPOINT_NAME_MAX = 60;
export const CHECKPOINT_DESC_MAX = 140;
export const MAX_CHECKPOINTS = 20;
/** Bounds what a relay or a hostile peer can make this device store per adventure. */
export const MAX_COMPLETIONS_PER_ADVENTURE = MAX_CHECKPOINTS * 12;
export const MAX_SYNC_ADVENTURES = 6;

/**
 * Planned -> Active <-> Paused -> Completed, with Cancelled reachable from any non-final state.
 * `draft` is an organizer's unpublished group activity: local only, never sent (publish -> active).
 */
export type AdventureStatus = 'draft' | 'planned' | 'active' | 'paused' | 'completed' | 'cancelled';
export const ADVENTURE_STATUSES: AdventureStatus[] = [
  'draft',
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

/**
 * What a phase asks of people. `checkpoint` is a place to reach; `collect` finds something (a
 * flower, a rock); `photo` is a photo anywhere; `task` is any other challenge.
 */
export type PhaseType = 'checkpoint' | 'collect' | 'photo' | 'task';
export const PHASE_TYPES: { type: PhaseType; label: string; hint: string }[] = [
  { type: 'checkpoint', label: 'Location Checkpoint', hint: 'Reach a specific location' },
  {
    type: 'collect',
    label: 'Collect Item',
    hint: 'Find and photograph something (e.g., a flower, leaf, rock)',
  },
  { type: 'photo', label: 'Take a Photo', hint: 'Capture a photo at any location' },
  { type: 'task', label: 'Custom Task', hint: 'Any other activity or challenge' },
];
export const phaseTypeLabel = (t: PhaseType): string =>
  PHASE_TYPES.find(x => x.type === t)?.label ?? 'Phase';

/** Arrival radius a person must be within, in metres, when the organizer sets none. */
export const PHASE_RADIUS_MIN_M = 15;
export const PHASE_RADIUS_MAX_M = 150;

export type ArrivalMethod = 'auto' | 'manual';
/** `done`: this person finished every phase of an activity (their own clock stops). */
export type ParticipantState = 'joined' | 'left' | 'done';

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
  /**
   * Activities: when this person did their last phase. Personal, never sent, and a header from the
   * organizer cannot change it. Null until then.
   */
  finishedAt?: number | null;
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
  /** A group activity: draft -> publish, immutable once published, per-person runs. */
  activity?: boolean;
  /** Activities only: phases must be completed in order. Absent means any order. */
  ordered?: boolean;
  /** Activities only: the area to download for offline use. */
  region?: MapArea | null;
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
  /** Null for a task phase that has no place (lat and lon are both set or both null). */
  lat: number | null;
  lon: number | null;
  /** What to do at this phase, e.g. "collect a yellow flower". */
  task: string | null;
  type: PhaseType;
  /** How close counts as "at the place"; null uses the person's own arrival-radius setting. */
  radiusM: number | null;
  /** Completing it needs a photo attached on the person's own phone. */
  requirePhoto: boolean;
  /**
   * Map area to fetch for this phase, [west, south, east, north]. The organizer's draft only:
   * at publish the regions are merged into the activity's one area and never sent per phase.
   */
  region: [number, number, number, number] | null;
  deleted: boolean;
};

/** Where a phase is, or null for a task phase with no place. */
export const placeOf = (c: Pick<Checkpoint, 'lat' | 'lon'>): { lat: number; lon: number } | null =>
  c.lat !== null && c.lon !== null ? { lat: c.lat, lon: c.lon } : null;

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

const RegionBoxSchema = z
  .tuple([latLon.lon, latLon.lat, latLon.lon, latLon.lat])
  .refine(
    ([w, s, e, n]) => w < e && s < n && e - w <= MAX_AREA_SPAN_DEG && n - s <= MAX_AREA_SPAN_DEG,
  );

export const CheckpointInputSchema = z
  .object({
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
    lat: latLon.lat.nullish(),
    lon: latLon.lon.nullish(),
    task: optionalText(CHECKPOINT_DESC_MAX),
    type: z.enum(['checkpoint', 'collect', 'photo', 'task']).default('checkpoint'),
    radiusM: z.number().int().min(PHASE_RADIUS_MIN_M).max(PHASE_RADIUS_MAX_M).nullish(),
    requirePhoto: z.boolean().default(false),
    /** Undefined: use a default box round the place. Null: no map region for this phase. */
    region: RegionBoxSchema.nullish(),
  })
  .refine(c => (c.lat == null) === (c.lon == null), 'lat and lon go together')
  .refine(c => c.type !== 'checkpoint' || c.lat != null, 'a location checkpoint needs a place');
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
  /** `draft` never goes on the wire. */
  status: z.enum(['planned', 'active', 'paused', 'completed', 'cancelled']),
  /** A group activity: each person starts and finishes their own run. */
  act: z.literal(1).nullish(),
  /** Activities: phases must be done in order. */
  ord: z.literal(1).nullish(),
  /** Activities: map area to download. */
  rg: MapAreaWireSchema.nullish(),
  st: z.object({ lat: latLon.lat, lon: latLon.lon, n: z.string().max(120).nullish() }).nullish(),
  ca: ts,
  sa: ts.nullish(),
  ea: ts.nullish(),
  /** Owner clock at the transition; used only to clamp personal segments. */
  ts,
});
export type AdventureHeader = z.infer<typeof AdventureHeaderSchema>;

export const CheckpointWireSchema = z
  .object({
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
    lat: latLon.lat.nullish(),
    lon: latLon.lon.nullish(),
    /** Task text of a phase (max 140 characters, doubled for multi-byte slack). */
    tx: z
      .string()
      .max(CHECKPOINT_DESC_MAX * 2)
      .nullish(),
    /** Phase type; absent means a location checkpoint (older senders). */
    ty: z.enum(['checkpoint', 'collect', 'photo', 'task']).nullish(),
    /** Arrival radius in metres. */
    rd: z.number().int().min(PHASE_RADIUS_MIN_M).max(PHASE_RADIUS_MAX_M).nullish(),
    /** A photo is needed to complete it. */
    rp: z.literal(1).nullish(),
    del: z.boolean().optional(),
    ts,
  })
  .refine(c => (c.lat == null) === (c.lon == null), 'lat and lon go together')
  .refine(
    c => c.del === true || c.lat != null || !!c.tx || (!!c.ty && c.ty !== 'checkpoint'),
    'a phase needs a place or a task',
  );
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
  state: z.enum(['joined', 'left', 'done']),
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
