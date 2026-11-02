import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { achievementById } from '../../domain/adventures/achievements';
import { elapsedMs } from '../../domain/adventures/lifecycle';
import {
  checkpointStatuses,
  formatClock,
  progressCounts,
  progressLabel,
} from '../../domain/adventures/stats';
import { thinRoute } from '../../domain/adventures/track';
import { formatDistanceIn } from '../../domain/geo/pace';
import { boundsOf } from '../../domain/adventures/route';
import {
  AdventureDetail,
  useAchievementRuntime,
  useAdventureDetail,
  useAdventureRuntime,
  useCurrentAdventure,
  useNavPrefs,
} from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { Banner, Card, IconTile, ListRow, Text } from '../../ui/components';
import { useReducedMotion } from '../../ui/motion';
import { space } from '../../ui/theme';
import { CheckpointPin, checkpointsCollection, routeCollection } from './overlays';

const PULSE_STEPS = [0, 1, 2];
const PULSE_STEP_MS = 300;
const TOAST_MS = 6_000;
/** Reload the drawn route at most this often; it can hold thousands of points. */
const ROUTE_REFRESH_MS = 15_000;

/** What the map draws for the adventure in view: its checkpoints, route and a gentle pulse. */
export function useAdventureMapState(showId: string | undefined) {
  const { adventuresRepo } = useServices();
  const current = useCurrentAdventure();
  const shownId = showId ?? current?.adventure.id ?? '';
  const detail = useAdventureDetail(shownId);
  const rt = useAdventureRuntime();
  const reduced = useReducedMotion();

  const [route, setRoute] = useState<{ lat: number; lon: number }[]>([]);
  useEffect(() => {
    if (!shownId) {
      setRoute([]);
      return;
    }
    let live = true;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      last = Date.now();
      void adventuresRepo.track(shownId).then(t => live && setRoute(thinRoute(t, 400)));
    };
    load();
    const unsub = adventuresRepo.changes.subscribe(() => {
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        load();
      }, Math.max(0, ROUTE_REFRESH_MS - (Date.now() - last)));
    });
    return () => {
      live = false;
      unsub();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [adventuresRepo, shownId]);

  const pins: CheckpointPin[] = useMemo(
    () =>
      detail
        ? detail.checkpoints.map(cp => ({
            id: cp.id,
            name: cp.name,
            lat: cp.lat,
            lon: cp.lon,
            reached: detail.completions.some(
              x => x.checkpointId === cp.id && x.address === detail.self,
            ),
          }))
        : [],
    [detail],
  );
  const checkpoints = useMemo(() => checkpointsCollection(pins), [pins]);
  const routeData = useMemo(() => routeCollection(route), [route]);

  // A short, small swell on the marker that was just reached. Skipped with reduced motion.
  const newest = rt.celebrations.filter(c => c.checkpointId).slice(-1)[0];
  const [pulse, setPulse] = useState<{ id: string; step: number } | null>(null);
  const lastPulse = useRef<string | null>(null);
  useEffect(() => {
    if (!newest?.checkpointId || reduced || lastPulse.current === newest.id) {
      return;
    }
    lastPulse.current = newest.id;
    const timers = PULSE_STEPS.map((step, i) =>
      setTimeout(() => setPulse({ id: newest.checkpointId as string, step }), i * PULSE_STEP_MS),
    );
    timers.push(setTimeout(() => setPulse(null), PULSE_STEPS.length * PULSE_STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [newest, reduced]);

  const bounds = useMemo(() => boundsOf([...pins, ...route]), [pins, route]);
  return { current, detail, checkpoints, route: routeData, pulse, bounds, shownId };
}

/** One quiet banner at a time, in the map's top stack: a badge, an arrival, a hint, or news. */
export function AdventureBanners({
  onOpenAchievements,
  onOpenCheckpoint,
  onOpenSummary,
}: {
  onOpenAchievements: () => void;
  onOpenCheckpoint: (adventureId: string, checkpointId: string) => void;
  onOpenSummary: (adventureId: string) => void;
}) {
  const { adventures, achievements } = useServices();
  const rt = useAdventureRuntime();
  const fresh = useAchievementRuntime().fresh;
  const toast = rt.celebrations.filter(c => c.kind !== 'adventure_complete').slice(-1)[0];
  const done = rt.celebrations.find(c => c.kind === 'adventure_complete');
  const [names, setNames] = useState<Record<string, string>>({});
  const { adventuresRepo } = useServices();

  useEffect(() => {
    if (!toast?.checkpointId) {
      return;
    }
    void adventuresRepo.checkpoint(toast.adventureId, toast.checkpointId).then(cp => {
      if (cp) {
        setNames(n => ({ ...n, [toast.id]: cp.name }));
      }
    });
    const t = setTimeout(() => adventures.dismissCelebration(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, adventures, adventuresRepo]);

  if (done) {
    return (
      <Banner
        title="Adventure finished"
        body="Your recap is ready in Adventures."
        actionLabel="View"
        onAction={() => {
          adventures.dismissCelebration(done.id);
          onOpenSummary(done.adventureId);
        }}
        onDismiss={() => adventures.dismissCelebration(done.id)}
      />
    );
  }
  if (fresh[0]) {
    const def = achievementById(fresh[0]);
    return (
      <Banner
        title={`Badge earned: ${def?.name ?? 'new badge'}`}
        actionLabel="View"
        onAction={onOpenAchievements}
        onDismiss={() => achievements.dismissFresh(fresh[0] as string)}
      />
    );
  }
  if (toast) {
    const name = names[toast.id];
    return (
      <Banner
        title={
          toast.kind === 'all_checkpoints'
            ? 'All checkpoints explored'
            : name
            ? `Reached ${name}`
            : 'Checkpoint reached'
        }
        onDismiss={() => adventures.dismissCelebration(toast.id)}
      />
    );
  }
  if (rt.hint) {
    const h = rt.hint;
    return (
      <Banner
        title={h.state === 'uncertain' ? `Near ${h.name}` : `Approaching ${h.name}`}
        body={
          h.state === 'uncertain'
            ? 'GPS is too weak to confirm. Mark it yourself when you are there.'
            : `About ${Math.round(h.distM)} m away. No rush.`
        }
        actionLabel={h.state === 'uncertain' ? 'I am here' : 'Details'}
        onAction={() =>
          h.state === 'uncertain'
            ? void adventures.confirmArrival(h.adventureId, h.checkpointId, 'manual')
            : onOpenCheckpoint(h.adventureId, h.checkpointId)
        }
      />
    );
  }
  const note = rt.notices[0];
  if (note) {
    return <Banner title={note.text} onDismiss={() => adventures.dismissNotices()} />;
  }
  return null;
}

/** Compact progress card for the adventure in progress. Taps through to the details. */
export function AdventureChip({
  detail,
  now,
  bottom,
  onPress,
}: {
  detail: AdventureDetail;
  now: number;
  bottom: number;
  onPress: () => void;
}) {
  const { units } = useNavPrefs();
  const { adventure: a, self, checkpoints, completions, participants } = detail;
  const counts = progressCounts(
    checkpointStatuses(checkpoints, completions, participants, self),
    self,
  );
  const parts = [
    counts.total > 0 ? progressLabel(counts).replace(' explored', '') : null,
    a.progress.distanceM > 0 ? formatDistanceIn(a.progress.distanceM, units) : null,
  ].filter(Boolean);
  return (
    <Card style={[styles.chip, { bottom }]} testID="adventure-chip">
      <ListRow
        title={a.status === 'paused' ? `${a.name} · paused` : a.name}
        subtitle={parts.length > 0 ? parts.join(' · ') : 'Adventure in progress'}
        leading={<IconTile name="trail" />}
        trailing={<ElapsedText ms={elapsedMs(a.progress, now)} />}
        chevron
        divider={false}
        onPress={onPress}
      />
    </Card>
  );
}

function ElapsedText({ ms }: { ms: number }) {
  return (
    <Text variant="mono" muted>
      {formatClock(ms)}
    </Text>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    paddingVertical: space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
