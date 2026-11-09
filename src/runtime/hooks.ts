import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Emitter } from '../data/events';
import type { PhaseRecord } from '../data/repositories/AdventuresRepo';
import {
  AchievementDef,
  AchievementProgress,
  ACHIEVEMENTS,
} from '../domain/adventures/achievements';
import { clampRadius, DEFAULT_RADIUS_M } from '../domain/adventures/arrival';
import type {
  Adventure,
  Checkpoint,
  Completion,
  Participant,
  StatusLogEntry,
  TrackPoint,
} from '../domain/adventures/model';
import { ActivityStanding, activityStanding } from '../domain/adventures/lifecycle';
import { SOLO_ADDRESS } from '../domain/adventures/model';
import type { Group, GroupMember, MeetingPoint, PointAck } from '../domain/groups/model';
import { DEFAULT_PACE_KMH, Units, clampPace } from '../domain/geo/pace';
import { Presence, meshStatus, MeshStatus, presenceOf } from '../domain/groups/presence';
import type { AchievementRuntime } from '../features/adventures/AchievementEngine';
import type { AdventureRuntime } from '../features/adventures/AdventureService';
import { RADIUS_KEY } from '../features/adventures/settings';
import type { GroupRuntime } from '../features/groups/GroupService';
import { Marker } from '../domain/markers/marker';
import { RegionRecord } from '../domain/maps/region';
import {
  boxIsInstalled,
  estimateAreaBytes,
  formatBytesShort,
  MapArea,
} from '../domain/maps/mapArea';
import type { BBox } from '../domain/geo';
import type { PubSubSnapshot } from '../mesh/PubSub';
import type { MeshSnapshot } from '../mesh/types';
import { useServices } from './services';

/** Re-runs `load` whenever any emitter fires. Table-level invalidation as in ARCHITECTURE.md 5. */
export function useLiveQuery<T>(
  emitters: Emitter<unknown>[],
  load: () => Promise<T>,
  initial: T,
  /** Re-load (and re-subscribe) when these change, e.g. the id a screen is showing. */
  deps: unknown[] = [],
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
  }, deps);
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

export type AreaDownload = {
  /** An installed region already covers the whole area. */
  covered: boolean;
  /** Progress 0..1 of a download (or pause) that covers the area, or null when none. */
  progress: number | null;
  /** "About 120 MB": an estimate until the download starts. */
  sizeText: string;
  busy: boolean;
  error: string | null;
  /** One tap: plan the area and start a normal region download (the person's own action). */
  download: () => Promise<void>;
};

const boxHas = (outer: BBox, inner: BBox) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

/** Download state for an area someone asked this person to fetch (a trip map, an activity area). */
export function useAreaDownload(area: MapArea | null): AreaDownload {
  const { packs } = useServices();
  const regions = useRegions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installed = regions.filter(r => r.state === 'installed' && r.filePath);
  const covered = !!area && boxIsInstalled(installed, area.bbox);
  const inFlight = area
    ? regions.find(
        r =>
          (r.state === 'downloading' || r.state === 'paused' || r.state === 'verifying') &&
          boxHas(r.bbox, area.bbox),
      )
    : undefined;
  const download = useCallback(async () => {
    if (!area) {
      return;
    }
    setBusy(true);
    setError(null);
    const plan = await packs.planArea(area.bbox, area.maxZoom);
    if (!plan.ok) {
      setBusy(false);
      setError(plan.error.userMessage);
      return;
    }
    const r = await packs.startArea(plan.value, area.name);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.userMessage);
    }
  }, [area, packs]);
  return {
    covered,
    progress: inFlight ? (inFlight.bytes > 0 ? inFlight.progressBytes / inFlight.bytes : 0) : null,
    sizeText: area
      ? `About ${formatBytesShort(estimateAreaBytes(area.bbox, area.minZoom, area.maxZoom))}`
      : '',
    busy,
    error,
    download,
  };
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

export type NavPrefs = { paceKmh: number; units: Units };

/** Walking pace and display units, stored locally in the kv table. */
export function useNavPrefs(): NavPrefs & {
  setPace: (kmh: number) => void;
  setUnits: (u: Units) => void;
} {
  const { kv } = useServices();
  const prefs = useLiveQuery<NavPrefs>(
    [kv.changes as Emitter<unknown>],
    async () => {
      const pace = Number(await kv.get('pref.paceKmh'));
      const units = await kv.get('pref.units');
      return {
        paceKmh: Number.isFinite(pace) && pace > 0 ? clampPace(pace) : DEFAULT_PACE_KMH,
        units: units === 'imperial' ? 'imperial' : 'metric',
      };
    },
    { paceKmh: DEFAULT_PACE_KMH, units: 'metric' },
  );
  return {
    ...prefs,
    setPace: kmh => void kv.set('pref.paceKmh', String(clampPace(kmh))),
    setUnits: u => void kv.set('pref.units', u),
  };
}

// ---- adventures --------------------------------------------------------------------------------

export function useAdventures(): Adventure[] {
  const { adventuresRepo } = useServices();
  return useLiveQuery(
    [adventuresRepo.changes as Emitter<unknown>],
    () => adventuresRepo.list(),
    [],
  );
}

/** This person's own notes and photos for the phases of one adventure, by phase id. */
export function usePhaseRecords(adventureId: string): Record<string, PhaseRecord> {
  const { adventuresRepo } = useServices();
  return useLiveQuery<Record<string, PhaseRecord>>(
    [adventuresRepo.changes as Emitter<unknown>],
    async () =>
      Object.fromEntries(
        (await adventuresRepo.phaseRecords(adventureId)).map(r => [r.checkpointId, r]),
      ),
    {},
    [adventureId],
  );
}

export type GroupActivity = {
  adventure: Adventure;
  standing: ActivityStanding;
  /** Phases this person has completed, and the phases in total. */
  done: number;
  total: number;
};

/** The activities of one group as this person sees them, newest first. */
export function useGroupActivities(groupId: string): GroupActivity[] {
  const { adventuresRepo, adventures } = useServices();
  const myAddress = useMesh().localAddress;
  return useLiveQuery<GroupActivity[]>(
    [adventuresRepo.changes as Emitter<unknown>],
    async () => {
      const out: GroupActivity[] = [];
      for (const adventure of await adventuresRepo.list()) {
        if (adventure.groupId !== groupId || !adventure.activity) {
          continue;
        }
        const self = adventures.selfFor(adventure);
        const mine = self ? (await adventuresRepo.participant(adventure.id, self))?.state : null;
        const phases = await adventuresRepo.checkpoints(adventure.id);
        const done = self
          ? (await adventuresRepo.completions(adventure.id)).filter(c => c.address === self)
          : [];
        out.push({
          adventure,
          standing: activityStanding(adventure, mine),
          done: phases.filter(p => done.some(d => d.checkpointId === p.id)).length,
          total: phases.length,
        });
      }
      return out;
    },
    [],
    [groupId, myAddress],
  );
}

export function useAdventureRuntime(): AdventureRuntime {
  const { adventures } = useServices();
  return useSyncExternalStore(adventures.subscribeChanges, adventures.getSnapshot);
}

export type AdventureDetail = {
  adventure: Adventure;
  /** Address standing for this device inside the adventure (`local` for solo ones). */
  self: string | null;
  checkpoints: Checkpoint[];
  completions: Completion[];
  participants: Participant[];
  log: StatusLogEntry[];
  /** Whether this person's clock can run (always true for solo adventures). */
  joined: boolean;
};

/** Everything one screen needs about an adventure, refreshed when anything stored changes. */
export function useAdventureDetail(id: string): AdventureDetail | null {
  const { adventuresRepo, adventures } = useServices();
  const myAddress = useMesh().localAddress;
  return useLiveQuery<AdventureDetail | null>(
    [adventuresRepo.changes as Emitter<unknown>],
    async () => {
      const adventure = await adventuresRepo.get(id);
      if (!adventure) {
        return null;
      }
      const self = adventures.selfFor(adventure);
      const participants = await adventuresRepo.participants(id);
      return {
        adventure,
        self,
        checkpoints: await adventuresRepo.checkpoints(id),
        completions: await adventuresRepo.completions(id),
        participants,
        log: await adventuresRepo.log(id),
        joined:
          adventure.groupId === null ||
          participants.some(p => p.address === self && p.state === 'joined'),
      };
    },
    null,
    [id, myAddress],
  );
}

export function useAdventureRoute(id: string): TrackPoint[] {
  const { adventuresRepo } = useServices();
  return useLiveQuery(
    [adventuresRepo.changes as Emitter<unknown>],
    () => adventuresRepo.track(id),
    [],
    [id],
  );
}

/** The adventure the person is on now: the running one, else a paused one. */
export function useCurrentAdventure(): AdventureDetail | null {
  const all = useAdventures();
  const cur = all.find(a => a.status === 'active') ?? all.find(a => a.status === 'paused') ?? null;
  const detail = useAdventureDetail(cur?.id ?? '');
  return cur && detail?.adventure.id === cur.id ? detail : null;
}

/** Checkpoints of the current adventure, for the map. */
export function useCheckpointRadius(): { radiusM: number; setRadius: (m: number) => void } {
  const { kv } = useServices();
  const radiusM = useLiveQuery(
    [kv.changes as Emitter<unknown>],
    async () => {
      const v = Number(await kv.get(RADIUS_KEY));
      return Number.isFinite(v) && v > 0 ? clampRadius(v) : DEFAULT_RADIUS_M;
    },
    DEFAULT_RADIUS_M,
  );
  return { radiusM, setRadius: m => void kv.set(RADIUS_KEY, String(clampRadius(m))) };
}

export type AchievementView = {
  def: AchievementDef;
  progress: AchievementProgress;
  unlockedAt: number | null;
};

export function useAchievements(): AchievementView[] {
  const { achievements, achievementsRepo, adventuresRepo } = useServices();
  return useLiveQuery<AchievementView[]>(
    [achievementsRepo.changes as Emitter<unknown>, adventuresRepo.changes as Emitter<unknown>],
    async () => {
      const progress = await achievements.progress();
      const unlocks = await achievementsRepo.list();
      return ACHIEVEMENTS.map(def => ({
        def,
        progress: progress.find(p => p.id === def.id) as AchievementProgress,
        unlockedAt: unlocks.find(u => u.id === def.id)?.unlockedAt ?? null,
      }));
    },
    [],
  );
}

export function useAchievementRuntime(): AchievementRuntime {
  const { achievements } = useServices();
  return useSyncExternalStore(achievements.subscribeChanges, achievements.getSnapshot);
}

/** Unlock ids earned on one adventure, for its recap. */
export function useUnlocksFor(adventureId: string): string[] {
  const { achievementsRepo } = useServices();
  return useLiveQuery(
    [achievementsRepo.changes as Emitter<unknown>],
    async () =>
      (await achievementsRepo.list()).filter(u => u.adventureId === adventureId).map(u => u.id),
    [],
    [adventureId],
  );
}

export { SOLO_ADDRESS };
