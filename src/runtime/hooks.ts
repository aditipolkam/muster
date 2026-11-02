import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Emitter } from '../data/events';
import type { Group, GroupMember, MeetingPoint, PointAck } from '../domain/groups/model';
import { Presence, meshStatus, MeshStatus, presenceOf } from '../domain/groups/presence';
import type { GroupRuntime } from '../features/groups/GroupService';
import { Marker } from '../domain/markers/marker';
import { RegionRecord } from '../domain/maps/region';
import type { PubSubSnapshot } from '../mesh/PubSub';
import type { MeshSnapshot } from '../mesh/types';
import { useServices } from './services';

/** Re-runs `load` whenever any emitter fires. Table-level invalidation as in ARCHITECTURE.md 5. */
export function useLiveQuery<T>(
  emitters: Emitter<unknown>[],
  load: () => Promise<T>,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(() => {
    loadRef.current().then(setValue, () => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const unsubs = emitters.map(e => e.subscribe(refresh));
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export function useMarkers(): Marker[] {
  const { points } = useServices();
  return useLiveQuery([points.changes as Emitter<unknown>], () => points.list(), []);
}

export function useRegions(): RegionRecord[] {
  const { regions } = useServices();
  return useLiveQuery([regions.changes as Emitter<unknown>], () => regions.list(), []);
}

/** Mesh state for screens. Snapshots are immutable, so identity changes only when something did. */
export function useMesh(): MeshSnapshot {
  const { mesh } = useServices();
  return useSyncExternalStore(mesh.subscribe, mesh.getSnapshot);
}

export function usePubSub(): PubSubSnapshot {
  const { pubsub } = useServices();
  return useSyncExternalStore(pubsub.subscribeChanges, pubsub.getSnapshot);
}

export function useGroupRuntime(): GroupRuntime {
  const { groups } = useServices();
  return useSyncExternalStore(groups.subscribeChanges, groups.getSnapshot);
}

export function useGroups(): Group[] {
  const { groupsRepo } = useServices();
  return useLiveQuery([groupsRepo.changes as Emitter<unknown>], () => groupsRepo.list(), []);
}

export function useGroup(groupId: string): Group | null {
  const { groupsRepo } = useServices();
  return useLiveQuery(
    [groupsRepo.changes as Emitter<unknown>],
    () => groupsRepo.get(groupId),
    null as Group | null,
  );
}

export function useGroupMembers(groupId: string): GroupMember[] {
  const { groupsRepo } = useServices();
  return useLiveQuery(
    [groupsRepo.changes as Emitter<unknown>],
    () => groupsRepo.members(groupId),
    [],
  );
}

export function useGroupPoints(groupId: string): MeetingPoint[] {
  const { meetingPoints } = useServices();
  return useLiveQuery(
    [meetingPoints.changes as Emitter<unknown>],
    () => meetingPoints.list(groupId),
    [],
  );
}

/** Live meeting points of every active group: what the map draws. */
export function useVisibleMeetingPoints(): MeetingPoint[] {
  const { meetingPoints, groupsRepo } = useServices();
  return useLiveQuery(
    [meetingPoints.changes as Emitter<unknown>, groupsRepo.changes as Emitter<unknown>],
    () => meetingPoints.listVisible(),
    [],
  );
}

export function useMeetingPoint(groupId: string, id: string): MeetingPoint | null {
  const { meetingPoints } = useServices();
  return useLiveQuery(
    [meetingPoints.changes as Emitter<unknown>],
    () => meetingPoints.get(groupId, id),
    null as MeetingPoint | null,
  );
}

export function usePointAcks(groupId: string, id: string): PointAck[] {
  const { meetingPoints } = useServices();
  return useLiveQuery(
    [meetingPoints.changes as Emitter<unknown>],
    () => meetingPoints.acks(groupId, id),
    [],
  );
}

export type MemberPresence = { member: GroupMember; presence: Presence };

/**
 * Who in the group is reachable, and how recently each was heard. Reachable means a nearby peer
 * or an active group subscription; last heard is the later of the last sighting and the last
 * group message from that address.
 */
export function useGroupPresence(
  group: Group | null,
  members: GroupMember[],
  now: number,
): { members: MemberPresence[]; reachable: number; status: MeshStatus } {
  const mesh = useMesh();
  const ps = usePubSub();
  const others = members.filter(m => m.state === 'active' && m.address !== mesh.localAddress);
  const withPresence = others.map(member => {
    const peer = mesh.peers.find(p => p.address === member.address);
    const sub = ps.subscriptions.some(
      s =>
        s.provider === member.address &&
        s.state === 'active' &&
        !!group &&
        s.topic.startsWith(`tm/1/${group.id}/`),
    );
    const msgAt = ps.received.reduce(
      (t, r) => (r.from === member.address && !r.duplicate && r.at > t ? r.at : t),
      0,
    );
    const heard = Math.max(peer?.lastSeenAt ?? 0, msgAt);
    const reachable = peer?.state === 'nearby' || sub;
    return {
      member,
      presence: presenceOf(now, {
        address: member.address,
        reachable,
        lastHeardAt: heard > 0 ? heard : null,
      }),
    };
  });
  const reachable = withPresence.filter(x => x.presence.reachable).length;
  return {
    members: withPresence,
    reachable,
    status: meshStatus({
      running: mesh.lifecycle === 'running',
      bluetoothOn: mesh.bluetooth !== 'off',
      hasGroup: !!group,
      total: withPresence.length,
      reachable,
    }),
  };
}
