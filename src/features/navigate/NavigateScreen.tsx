import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { placeOf } from '../../domain/adventures/model';
import { bearingDeg, distanceM, formatCoord } from '../../domain/geo';
import {
  cardinal16Of,
  cardinalOf,
  etaMinutes,
  formatDistanceIn,
  formatEta,
  turnHint,
} from '../../domain/geo/pace';
import { usableHeading } from '../../domain/location/fix';
import { useLocationStore } from '../../platform/locationStore';
import {
  useAdventures,
  useGroups,
  useMarkers,
  useNavPrefs,
  useVisibleMeetingPoints,
} from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { RootTabParamList } from '../../runtime/navigation';
import { useNavSession } from '../../runtime/navSession';
import { Badge, Icon, IconTile, Screen, Text } from '../../ui/components';
import { radius, space, tabular, useTheme } from '../../ui/theme';
import { MetricStrip, NavControls } from '../../ui/trail';
import { TargetPicker } from './TargetPicker';
import { refKey, TargetRef, targetSections } from './targets';

type Props = BottomTabScreenProps<RootTabParamList, 'Navigate'>;

const CARDINALS: { label: string; deg: number }[] = [
  { label: 'N', deg: 0 },
  { label: 'E', deg: 90 },
  { label: 'S', deg: 180 },
  { label: 'W', deg: 270 },
];
const RING = 260;
/** Where the letters sit, from the centre. */
const LETTER_R = RING / 2 - 24;
const MARK_R = RING / 2 - 2;

/** Deep-link params (a meeting point, marker or checkpoint) -> the target they ask for. */
function refFromParams(
  p: RootTabParamList['Navigate'],
  points: { groupId: string; id: string }[],
): TargetRef | null {
  if (p?.adventureId && p.checkpointId) {
    return { kind: 'checkpoint', adventureId: p.adventureId, checkpointId: p.checkpointId };
  }
  if (p?.pointId) {
    const hit = points.find(x => x.id === p.pointId && (!p.groupId || x.groupId === p.groupId));
    return hit ? { kind: 'meeting', groupId: hit.groupId, id: hit.id } : null;
  }
  return p?.markerId ? { kind: 'marker', id: p.markerId } : null;
}

/**
 * A compass that works on its own (north and heading) and can optionally point at a location
 * picked from a dropdown: meeting points shared in your groups, or places you marked. Straight
 * line, not turn-by-turn.
 */
export function NavigateScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useNavSession(s => s.target);
  const startSession = useNavSession(s => s.start);
  const endSession = useNavSession(s => s.end);
  const points = useVisibleMeetingPoints();
  const markers = useMarkers();
  const groups = useGroups();
  const fix = useLocationStore(s => s.fix);
  const heading = useLocationStore(s => s.headingDeg);
  const p = route.params;
  const { adventuresRepo } = useServices();
  const adventureList = useAdventures();
  const { paceKmh, units } = useNavPrefs();
  const fmt = (m: number) => formatDistanceIn(m, units);

  const [ref, setRef] = useState<TargetRef | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [checkpoint, setCheckpoint] = useState<{ name: string; lat: number; lon: number } | null>(
    null,
  );

  // Ending navigation (here or on the map) also clears what was picked here.
  const hadSession = React.useRef(false);
  useEffect(() => {
    if (hadSession.current && !session) {
      setRef(null);
    }
    hadSession.current = !!session;
  }, [session]);

  // A deep link selects its target once per navigation (re-sent with a new `nonce`/params).
  const paramKey = `${p?.groupId ?? ''}|${p?.pointId ?? ''}|${p?.markerId ?? ''}|${
    p?.adventureId ?? ''
  }|${p?.checkpointId ?? ''}`;
  useEffect(() => {
    if (paramKey === '||||') {
      return;
    }
    const next = refFromParams(p, points);
    if (next) {
      setRef(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey, points.length]);

  const ckpAdventure = ref?.kind === 'checkpoint' ? ref.adventureId : null;
  const ckpId = ref?.kind === 'checkpoint' ? ref.checkpointId : null;
  useEffect(() => {
    if (!ckpAdventure || !ckpId) {
      setCheckpoint(null);
      return;
    }
    void adventuresRepo.checkpoint(ckpAdventure, ckpId).then(cp => {
      const place = cp && !cp.deleted ? placeOf(cp) : null;
      setCheckpoint(cp && place ? { name: cp.name, ...place } : null);
    });
  }, [adventuresRepo, ckpAdventure, ckpId, adventureList]);

  const sections = useMemo(
    () => targetSections(groups, points, markers),
    [groups, points, markers],
  );

  const refTarget = useMemo(() => {
    if (!ref) {
      return null;
    }
    if (ref.kind === 'checkpoint') {
      return checkpoint
        ? { kind: 'checkpoint' as const, subtitle: 'Checkpoint', ...checkpoint }
        : null;
    }
    if (ref.kind === 'meeting') {
      const m = points.find(x => x.groupId === ref.groupId && x.id === ref.id && !x.deleted);
      const g = groups.find(x => x.id === ref.groupId);
      return m
        ? {
            kind: 'meeting' as const,
            name: m.name,
            subtitle: g?.name ?? 'Group',
            lat: m.lat,
            lon: m.lon,
          }
        : null;
    }
    const mk = markers.find(x => x.id === ref.id);
    return mk
      ? {
          kind: 'marker' as const,
          name: mk.name,
          subtitle: 'Marked by you',
          lat: mk.lat,
          lon: mk.lon,
        }
      : null;
  }, [checkpoint, groups, markers, points, ref]);

  // Choosing a destination here starts (or switches) the shared navigation session, so the Map
  // view draws the same line. Without one chosen here, show the session's destination.
  const refKeyStr = ref ? refKey(ref) : null;
  useEffect(() => {
    if (refTarget) {
      startSession({
        name: refTarget.name,
        lat: refTarget.lat,
        lon: refTarget.lon,
        kind: refTarget.kind,
        key:
          ref?.kind === 'meeting'
            ? `${ref.groupId}:${ref.id}`
            : ref?.kind === 'marker'
            ? ref.id
            : undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKeyStr, refTarget?.lat, refTarget?.lon, refTarget?.name]);
  // The session is the destination (the map may have started or changed it); what was picked
  // here only adds detail (e.g. the group name) when it is the same place.
  const sameAsRef =
    !!refTarget && !!session && refTarget.lat === session.lat && refTarget.lon === session.lon;
  const target = session
    ? sameAsRef
      ? refTarget
      : {
          kind: session.kind ?? ('pin' as const),
          name: session.name,
          subtitle:
            session.kind === 'meeting'
              ? 'Meeting point'
              : session.kind === 'marker'
              ? 'Marked by you'
              : session.kind === 'checkpoint'
              ? 'Checkpoint'
              : 'Pin on the map',
          lat: session.lat,
          lon: session.lon,
        }
    : refTarget;

  const picker = (
    <TargetPicker
      visible={pickerOpen}
      sections={sections}
      selectedKey={ref ? refKey(ref) : null}
      onPick={o => {
        setRef(o.ref);
        setPickerOpen(false);
      }}
      onClear={() => {
        setRef(null);
        endSession();
        setPickerOpen(false);
      }}
      onClose={() => setPickerOpen(false)}
    />
  );

  const dist = fix && target ? distanceM(fix, target) : null;
  const bearing = fix && target ? bearingDeg(fix, target) : null;
  const h = usableHeading(heading);
  // Heading-up: the phone's facing is always at the top. Letters move round the ring but stay
  // upright; the target sits at (bearing - heading).
  const rel = (deg: number) => (h === undefined ? deg : deg - h);
  const minutes = etaMinutes(dist, paceKmh);
  const targetRel = bearing === null ? null : rel(bearing);
  const turn = targetRel === null || h === undefined ? null : turnHint(targetRel);
  const ringPos = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return { left: RING / 2 + r * Math.sin(a), top: RING / 2 - r * Math.cos(a) };
  };
  // The soft green arc between where you face (0) and the target.
  const sweep = targetRel === null || h === undefined ? 0 : ((targetRel + 540) % 360) - 180;
  const arcDots =
    Math.abs(sweep) < 4
      ? []
      : Array.from({ length: Math.floor(Math.abs(sweep) / 4) }, (_, i) => Math.sign(sweep) * i * 4);
  const end = () => {
    endSession();
    setRef(null);
    navigation.navigate('Map');
  };

  const dialA11y = target
    ? bearing === null
      ? 'Compass unavailable until GPS has a fix'
      : `${target.name} is ${fmt(dist!)} towards ${cardinalOf(
          bearing,
        )}. Straight line, terrain not considered`
    : heading === null
    ? 'Compass waiting for a heading'
    : `Facing ${cardinalOf(heading)}, ${Math.round(heading)} degrees`;

  const dial = (
    <View style={styles.compass} accessible accessibilityLabel={dialA11y}>
      <View style={[styles.phoneMark, { borderTopColor: c.text }]} testID="compass-facing" />
      <View
        style={[styles.ring, { borderColor: c.border, backgroundColor: c.surface }]}
        testID="compass-dial"
      >
        {arcDots.map(d => {
          const pos = ringPos(d, MARK_R - 14);
          return (
            <View
              key={d}
              pointerEvents="none"
              style={[
                styles.arcDot,
                { backgroundColor: c.primarySoft, left: pos.left - 9, top: pos.top - 9 },
              ]}
            />
          );
        })}
        {CARDINALS.map(({ label, deg }) => {
          const pos = ringPos(rel(deg), LETTER_R);
          return (
            <View
              key={label}
              pointerEvents="none"
              testID={`dial-${label}`}
              style={[styles.letter, { left: pos.left - 14, top: pos.top - 12 }]}
            >
              <Text
                variant="cardTitle"
                color={label === 'N' ? c.danger : c.textMuted}
                style={{ textAlign: 'center' }}
              >
                {label}
              </Text>
            </View>
          );
        })}
        {targetRel !== null ? (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.targetDot,
                {
                  backgroundColor: c.meeting,
                  borderColor: c.surface,
                  left: ringPos(targetRel, MARK_R - 14).left - 9,
                  top: ringPos(targetRel, MARK_R - 14).top - 9,
                },
              ]}
            />
            <View style={{ transform: [{ rotate: `${targetRel}deg` }] }} testID="compass-arrow">
              <Icon name="arrowUp" size={92} color={c.meeting} />
            </View>
          </>
        ) : (
          <Icon name="compass" size={56} color={c.border} />
        )}
      </View>
    </View>
  );

  if (target) {
    return (
      <Screen edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.navHead}>
            <View style={{ flex: 1 }} testID="nav-target">
              <Text variant="title" numberOfLines={1}>
                {target.name}
              </Text>
              <Text variant="caption" muted numberOfLines={1}>
                {dist === null || bearing === null
                  ? `${target.subtitle} · ${formatCoord(target)}`
                  : `${target.subtitle} · ${fmt(dist)} · ${cardinalOf(bearing)} ${Math.round(
                      bearing,
                    )}°`}
              </Text>
            </View>
            <Pressable
              testID="target-select"
              accessibilityRole="button"
              accessibilityLabel={`Pointing at ${target.name}. Change location`}
              onPress={() => setPickerOpen(true)}
              hitSlop={8}
              style={styles.change}
            >
              <Text variant="caption" color={c.primary} style={{ fontWeight: '800' }}>
                Change
              </Text>
            </Pressable>
          </View>
          {dial}
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <Text variant="metric" style={styles.big} testID="nav-distance">
              {dist === null ? '–' : fmt(dist)}
            </Text>
            <View style={[styles.turn, { backgroundColor: c.primarySoft }]} testID="nav-turn">
              <Text variant="cardTitle" color={c.deep}>
                {bearing === null
                  ? 'Waiting for GPS'
                  : turn ?? `Turn to face ${cardinal16Of(bearing)}`}
              </Text>
            </View>
            <Badge tone="warn" icon="warning" label="Straight line · terrain not considered" />
          </View>
          <MetricStrip
            items={[
              { label: 'On foot', value: minutes === null ? '–' : `~${formatEta(minutes)}` },
              {
                label: 'Target bearing',
                value: bearing === null ? '–' : `${cardinal16Of(bearing)} ${Math.round(bearing)}°`,
              },
              {
                label: 'Compass',
                value: h === undefined ? 'No heading' : 'On',
                tone: h === undefined ? 'warn' : 'good',
              },
            ]}
          />
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            {`Time at ${paceKmh} km/h on flat ground. Trails, cliffs and water may not follow this line.`}
          </Text>
        </ScrollView>
        <View
          style={[
            styles.panel,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              paddingBottom: insets.bottom + space.lg,
            },
          ]}
        >
          <NavControls
            name={target.name}
            subtitle={target.subtitle}
            view="compass"
            onView={v => v === 'map' && navigation.navigate('Map')}
            onEnd={end}
          />
        </View>
        {picker}
      </Screen>
    );
  }

  return (
    <Screen title="Compass">
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          testID="target-select"
          accessibilityRole="button"
          accessibilityLabel="Choose a location"
          onPress={() => setPickerOpen(true)}
          style={[styles.select, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <IconTile name="compass" />
          <View style={{ flex: 1 }} testID="nav-target">
            <Text variant="cardTitle" numberOfLines={1}>
              Compass only
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              Choose a location to point at
            </Text>
          </View>
          <Icon name="down" size={20} color={c.textMuted} />
        </Pressable>
        {dial}
        <View style={{ alignItems: 'center', gap: space.xs }}>
          <Text variant="metric" style={styles.big} testID="compass-heading">
            {heading === null ? '–' : `${Math.round(heading)}°`}
          </Text>
          <Text muted>
            {heading === null ? 'Waiting for a heading' : `facing ${cardinalOf(heading)}`}
          </Text>
        </View>
      </ScrollView>
      {picker}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, paddingTop: space.sm, gap: space.lg, paddingBottom: space.xxl },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  navHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  change: { minHeight: 44, justifyContent: 'center' },
  compass: { alignItems: 'center', paddingTop: space.sm },
  phoneMark: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 13,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginBottom: space.xs,
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { position: 'absolute', width: 28, height: 24 },
  arcDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9 },
  targetDot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  big: { fontSize: 40, lineHeight: 46, ...tabular },
  turn: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  panel: {
    padding: space.gutter,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
  },
});
