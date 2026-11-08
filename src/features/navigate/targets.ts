import type { Group, MeetingPoint } from '../../domain/groups/model';
import type { Marker } from '../../domain/markers/marker';

/** What the compass points at. Checkpoints come from deep links and are resolved separately. */
export type TargetRef =
  | { kind: 'meeting'; groupId: string; id: string }
  | { kind: 'marker'; id: string }
  | { kind: 'checkpoint'; adventureId: string; checkpointId: string };

export type TargetOption = {
  key: string;
  ref: TargetRef;
  name: string;
  /** The group it was shared in, or "Marked by you". */
  subtitle: string;
  lat: number;
  lon: number;
};

export type TargetSection = { title: string; data: TargetOption[] };

export const MY_PLACES = 'My places';

export const refKey = (r: TargetRef): string =>
  r.kind === 'meeting'
    ? `m:${r.groupId}:${r.id}`
    : r.kind === 'marker'
    ? `k:${r.id}`
    : `c:${r.adventureId}:${r.checkpointId}`;

/**
 * Locations to pick from, one section per group that has shared a meeting point (sorted by
 * name), then the places the user marked.
 */
export function targetSections(
  groups: Group[],
  points: MeetingPoint[],
  markers: Marker[],
): TargetSection[] {
  const sections: TargetSection[] = [];
  const active = groups
    .filter(g => g.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const g of active) {
    const data = points
      .filter(p => p.groupId === g.id && !p.deleted)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map<TargetOption>(p => {
        const ref: TargetRef = { kind: 'meeting', groupId: p.groupId, id: p.id };
        return { key: refKey(ref), ref, name: p.name, subtitle: g.name, lat: p.lat, lon: p.lon };
      });
    if (data.length > 0) {
      sections.push({ title: g.name, data });
    }
  }
  if (markers.length > 0) {
    sections.push({
      title: MY_PLACES,
      data: [...markers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map<TargetOption>(m => {
          const ref: TargetRef = { kind: 'marker', id: m.id };
          return {
            key: refKey(ref),
            ref,
            name: m.name,
            subtitle: 'Marked by you',
            lat: m.lat,
            lon: m.lon,
          };
        }),
    });
  }
  return sections;
}
