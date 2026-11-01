import { z } from 'zod';
import { isValidLatLon } from '../geo';

export const GROUP_NAME_MAX = 60;
export const MEMBER_NAME_MAX = 40;
export const POINT_NAME_MAX = 60;
/** Kept small so a point always fits the 2 KB envelope budget even in multi-byte scripts. */
export const POINT_NOTE_MAX = 280;
/** MESH_PROTOCOL.md section 2.1: design target 2-12; each member costs the organizer 3 subscriptions. */
export const MAX_GROUP_MEMBERS = 12;
export const MAX_POINTS_PER_GROUP = 50;
/** Entries a sync request may list (bounds the request size). */
export const MAX_SYNC_POINTS = 15;
export const APP_PROTOCOL = 1;

export type GroupRole = 'organizer' | 'member';
/** `joining`: invite sent, welcome not yet received. `closed`: the organizer ended the group. */
export type GroupStatus = 'joining' | 'active' | 'closed';
export type MemberState = 'active' | 'left' | 'removed';

export type Group = {
  id: string;
  name: string;
  organizer: string;
  role: GroupRole;
  status: GroupStatus;
  createdAt: number;
  joinedAt: number | null;
  /** Highest member-event `rev` seen (organizer: highest issued). */
  memberRev: number;
};

export type GroupMember = {
  groupId: string;
  address: string;
  name: string;
  role: GroupRole;
  state: MemberState;
  rev: number;
  updatedAt: number;
};

export type MeetingPoint = {
  groupId: string;
  id: string;
  rev: number;
  name: string;
  note: string | null;
  lat: number;
  lon: number;
  deleted: boolean;
  createdBy: string;
  /** The address that authored this revision; the winner tie-break (MESH_PROTOCOL.md section 3.3). */
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
  receivedAt: number;
  /** Highest revision this device acknowledged, 0 if none. */
  ackedRev: number;
  /** Whether that acknowledgment reached at least one live subscriber (the organizer). */
  ackPublished: boolean;
};

export type PointAck = {
  groupId: string;
  pointId: string;
  address: string;
  rev: number;
  at: number;
};

// ---- wire payloads (the `p` of the envelope; untrusted, always parsed) ---------------------------

const addr = z.string().min(1).max(128);
const id = z.string().min(1).max(64);
const rev = z.number().int().min(0).max(2_000_000_000);
const ts = z.number().int().nonnegative();

export const MemberEventSchema = z.object({
  addr,
  name: z.string().trim().min(1).max(MEMBER_NAME_MAX),
  role: z.enum(['organizer', 'member']),
  rev,
});
export type MemberEvent = z.infer<typeof MemberEventSchema>;

export const ClosedEventSchema = z.object({ rev });

export const PointPayloadSchema = z.object({
  id,
  rev: rev.min(1),
  name: z.string().trim().min(1).max(POINT_NAME_MAX),
  note: z.string().max(POINT_NOTE_MAX).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  by: addr,
  createdBy: addr,
  createdAt: ts,
  ts,
});
export type PointPayload = z.infer<typeof PointPayloadSchema>;

export const PointRemovedSchema = z.object({ id, rev: rev.min(1), by: addr, ts });
export type PointRemoved = z.infer<typeof PointRemovedSchema>;

export const AckPayloadSchema = z.object({ pointId: id, rev: rev.min(1) });
export const HelloPayloadSchema = z.object({
  name: z.string().trim().min(1).max(MEMBER_NAME_MAX),
  appV: z.number().int().min(0).max(1000),
});
export const SyncPayloadSchema = z.object({
  /** Highest member `rev` the requester holds. */
  mrev: rev,
  points: z.array(z.object({ id, rev })).max(MAX_SYNC_POINTS),
});
export const WelcomeSchema = z.object({
  g: id,
  name: z.string().trim().min(1).max(GROUP_NAME_MAX),
  o: addr,
  mrev: rev,
});
export const BeaconSchema = z.object({
  g: id,
  n: z.string().trim().min(1).max(GROUP_NAME_MAX),
  o: addr,
  until: ts,
});
export type Beacon = z.infer<typeof BeaconSchema>;

export const GroupNameSchema = z.string().trim().min(1).max(GROUP_NAME_MAX);
export const MemberNameSchema = z.string().trim().min(1).max(MEMBER_NAME_MAX);

export const PointInputSchema = z.object({
  name: z.string().trim().min(1).max(POINT_NAME_MAX),
  note: z.string().trim().max(POINT_NOTE_MAX).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type PointInput = z.infer<typeof PointInputSchema>;

export function isValidPointPosition(lat: number, lon: number): boolean {
  return isValidLatLon(lat, lon);
}

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
}

export function defaultMemberName(address: string): string {
  return `Hiker ${address.slice(-4)}`;
}
