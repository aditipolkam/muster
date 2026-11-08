import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { placeOf } from '../../domain/adventures/model';
import { bearingDeg, distanceM, formatCoord } from '../../domain/geo';
import { cardinalOf, etaMinutes, formatDistanceIn, formatEta } from '../../domain/geo/pace';
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
import { Badge, Card, Icon, IconTile, Screen, Text } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';
import { TargetPicker } from './TargetPicker';
import { refKey, TargetRef, targetSections } from './targets';

type Props = BottomTabScreenProps<RootTabParamList, 'Navigate'>;

const CARDINALS: { label: string; deg: number }[] = [
  { label: 'N', deg: 0 },
  { label: 'E', deg: 90 },
  { label: 'S', deg: 180 },
  { label: 'W', deg: 270 },
];
const RING = 220;

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
export function NavigateScreen({ route }: Props) {
  const { c } = useTheme();
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

  const target = useMemo(() => {
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

  const dist = fix && target ? distanceM(fix, target) : null;
  const bearing = fix && target ? bearingDeg(fix, target) : null;
  // The dial turns so north stays north under the phone; the arrow sits on the dial at the
  // absolute bearing, which puts it at (bearing - heading) relative to where the phone points.
  const dial = heading === null ? 0 : -heading;
  const minutes = etaMinutes(dist, paceKmh);
  const tone = target?.kind === 'meeting' ? c.mapMeeting : c.primary;

  return (
    <Screen title="Compass">
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          testID="target-select"
          accessibilityRole="button"
          accessibilityLabel={
            target ? `Pointing at ${target.name}. Change location` : 'Choose a location'
          }
          onPress={() => setPickerOpen(true)}
          style={[styles.select, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <IconTile
            name={target ? (target.kind === 'meeting' ? 'flag' : 'pin') : 'compass'}
            color={tone}
            bg={target?.kind === 'meeting' ? c.mapMeeting + '22' : c.primarySoft}
          />
          <View style={{ flex: 1 }} testID="nav-target">
            <Text variant="cardTitle" numberOfLines={1}>
              {target ? target.name : 'Compass only'}
            </Text>
            <Text variant="caption" muted numberOfLines={1}>
              {target
                ? dist === null || bearing === null
                  ? `${target.subtitle} · ${formatCoord(target)}`
                  : `${target.subtitle} · ${fmt(dist)} · ${cardinalOf(bearing)} ${Math.round(
                      bearing,
                    )}°`
                : 'Choose a location to point at'}
            </Text>
          </View>
          <Text muted>▾</Text>
        </Pressable>

        <View
          style={styles.compass}
          accessible
          accessibilityLabel={
            target
              ? bearing === null
                ? 'Compass unavailable until GPS has a fix'
                : `${target.name} is ${fmt(dist!)} towards ${cardinalOf(
                    bearing,
                  )}. Straight line, terrain not considered`
              : heading === null
              ? 'Compass waiting for a heading'
              : `Facing ${cardinalOf(heading)}, ${Math.round(heading)} degrees`
          }
        >
          <View style={[styles.phoneMark, { borderBottomColor: c.text }]} />
          <View
            style={[styles.ring, { borderColor: c.primary, transform: [{ rotate: `${dial}deg` }] }]}
            testID="compass-dial"
          >
            {CARDINALS.map(({ label, deg }) => (
              <View
                key={label}
                style={[styles.tick, { transform: [{ rotate: `${deg}deg` }] }]}
                pointerEvents="none"
              >
                <Text
                  variant="label"
                  color={label === 'N' ? c.danger : c.textMuted}
                  style={styles.tickLabel}
                >
                  {label}
                </Text>
              </View>
            ))}
            {bearing !== null ? (
              <View style={{ transform: [{ rotate: `${bearing}deg` }] }}>
                <Icon name="navigate" size={96} color={tone} />
              </View>
            ) : null}
          </View>
          {target ? (
            <>
              <Text variant="metric" testID="nav-distance">
                {dist === null ? '–' : fmt(dist)}
              </Text>
              <Text muted>
                {bearing === null ? 'Waiting for GPS' : `towards ${cardinalOf(bearing)}`}
              </Text>
              <Badge label="Straight line · terrain not considered" tone="warn" />
            </>
          ) : (
            <>
              <Text variant="metric" testID="compass-heading">
                {heading === null ? '–' : `${Math.round(heading)}°`}
              </Text>
              <Text muted>
                {heading === null ? 'Waiting for a heading' : `facing ${cardinalOf(heading)}`}
              </Text>
            </>
          )}
        </View>

        {target ? (
          <>
            <View style={styles.metrics}>
              <Card style={[styles.row, { flex: 1 }]}>
                <Icon name="walk" size={20} color={c.textMuted} />
                <View>
                  <Text variant="cardTitle">
                    {minutes === null ? '–' : `~ ${formatEta(minutes)}`}
                  </Text>
                  <Text variant="caption" muted>{`at ${paceKmh} km/h, flat ground`}</Text>
                </View>
              </Card>
              <Card style={[styles.row, { flex: 1 }]}>
                <Icon name="bearing" size={20} color={c.textMuted} />
                <View>
                  <Text variant="cardTitle">
                    {bearing === null ? '–' : `${Math.round(bearing)}°`}
                  </Text>
                  <Text variant="caption" muted>
                    bearing
                  </Text>
                </View>
              </Card>
            </View>
            <Text variant="caption" muted style={{ textAlign: 'center' }}>
              This points directly at the target. Trails, cliffs and water may not follow it, and
              the time ignores climbs.
            </Text>
          </>
        ) : null}
      </ScrollView>

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
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, paddingTop: 0, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  compass: { alignItems: 'center', gap: space.xs, paddingVertical: space.lg },
  phoneMark: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginBottom: space.xs,
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  tick: {
    position: 'absolute',
    width: RING,
    height: RING,
    alignItems: 'center',
  },
  tickLabel: { marginTop: space.sm, fontWeight: '700' },
  metrics: { flexDirection: 'row', gap: space.md },
});
