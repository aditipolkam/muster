import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { bearingDeg, distanceM, formatCoord } from '../../domain/geo';
import { cardinalOf, etaMinutes, formatDistanceIn, formatEta } from '../../domain/geo/pace';
import { useLocationStore } from '../../platform/locationStore';
import {
  useAdventures,
  useMarkers,
  useNavPrefs,
  useVisibleMeetingPoints,
} from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { RootTabParamList } from '../../runtime/navigation';
import { Badge, Card, EmptyState, Icon, IconTile, Screen, Text } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

type Props = BottomTabScreenProps<RootTabParamList, 'Navigate'>;

/** Straight-line guidance to a meeting point or saved place; not turn-by-turn. */
export function NavigateScreen({ navigation, route }: Props) {
  const { c } = useTheme();
  const points = useVisibleMeetingPoints();
  const markers = useMarkers();
  const fix = useLocationStore(s => s.fix);
  const heading = useLocationStore(s => s.headingDeg);
  const p = route.params;
  const { adventuresRepo } = useServices();
  const adventureList = useAdventures();
  const [checkpoint, setCheckpoint] = React.useState<{
    name: string;
    lat: number;
    lon: number;
  } | null>(null);
  React.useEffect(() => {
    if (!p?.adventureId || !p.checkpointId) {
      setCheckpoint(null);
      return;
    }
    void adventuresRepo.checkpoint(p.adventureId, p.checkpointId).then(cp => {
      setCheckpoint(cp && !cp.deleted ? { name: cp.name, lat: cp.lat, lon: cp.lon } : null);
    });
  }, [adventuresRepo, p?.adventureId, p?.checkpointId, adventureList]);
  const { paceKmh, units } = useNavPrefs();
  const fmt = (m: number) => formatDistanceIn(m, units);

  const target = useMemo(() => {
    if (checkpoint) {
      return { kind: 'checkpoint' as const, ...checkpoint };
    }
    const live = points.filter(x => !x.deleted);
    const meeting = p?.pointId
      ? live.find(x => x.id === p.pointId && (!p.groupId || x.groupId === p.groupId))
      : live[0];
    if (meeting) {
      return { kind: 'meeting' as const, name: meeting.name, lat: meeting.lat, lon: meeting.lon };
    }
    const marker = p?.markerId ? markers.find(m => m.id === p.markerId) : undefined;
    return marker
      ? { kind: 'marker' as const, name: marker.name, lat: marker.lat, lon: marker.lon }
      : null;
  }, [checkpoint, markers, p?.groupId, p?.markerId, p?.pointId, points]);

  if (!target) {
    return (
      <Screen title="Navigate">
        <EmptyState
          title="Nothing to navigate to"
          body="When your group shares a meeting point, or you save a place on the map, you can follow a straight-line arrow to it here."
          actionLabel="Open map"
          onAction={() => navigation.navigate('Map')}
        />
      </Screen>
    );
  }

  const dist = fix ? distanceM(fix, target) : null;
  const bearing = fix ? bearingDeg(fix, target) : null;
  // The arrow is drawn relative to where the phone points when a heading is known,
  // otherwise relative to north (the compass ring then reads as a map).
  const arrow = bearing === null ? 0 : (bearing - (heading ?? 0) + 360) % 360;
  const minutes = etaMinutes(dist, paceKmh);
  const tone = target.kind === 'meeting' ? c.mapMeeting : c.primary;

  return (
    <Screen title="Navigate">
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.row} testID="nav-target">
          <IconTile
            name={target.kind === 'meeting' ? 'flag' : 'pin'}
            color={tone}
            bg={target.kind === 'meeting' ? c.mapMeeting + '22' : c.primarySoft}
          />
          <View style={{ flex: 1 }}>
            <Text variant="cardTitle">{target.name}</Text>
            <Text variant="caption" muted>
              {dist === null || bearing === null
                ? formatCoord(target)
                : `${fmt(dist)} · ${cardinalOf(bearing)} ${Math.round(bearing)}°`}
            </Text>
          </View>
        </Card>

        <View
          style={styles.compass}
          accessible
          accessibilityLabel={
            bearing === null
              ? 'Compass unavailable until GPS has a fix'
              : `${target.name} is ${fmt(dist!)} towards ${cardinalOf(
                  bearing,
                )}. Straight line, terrain not considered`
          }
        >
          <View style={[styles.ring, { borderColor: c.primary }]}>
            <Text variant="label" style={styles.north}>
              N
            </Text>
            <View style={{ transform: [{ rotate: `${arrow}deg` }] }}>
              <Icon name="navigate" size={96} color={tone} />
            </View>
          </View>
          <Text variant="metric" testID="nav-distance">
            {dist === null ? '–' : fmt(dist)}
          </Text>
          <Text muted>
            {bearing === null ? 'Waiting for GPS' : `towards ${cardinalOf(bearing)}`}
          </Text>
          <Badge label="Straight line · terrain not considered" tone="warn" />
        </View>

        <View style={styles.metrics}>
          <Card style={[styles.row, { flex: 1 }]}>
            <Icon name="walk" size={20} color={c.textMuted} />
            <View>
              <Text variant="cardTitle">{minutes === null ? '–' : `~ ${formatEta(minutes)}`}</Text>
              <Text variant="caption" muted>{`at ${paceKmh} km/h, flat ground`}</Text>
            </View>
          </Card>
          <Card style={[styles.row, { flex: 1 }]}>
            <Icon name="bearing" size={20} color={c.textMuted} />
            <View>
              <Text variant="cardTitle">{bearing === null ? '–' : `${Math.round(bearing)}°`}</Text>
              <Text variant="caption" muted>
                bearing
              </Text>
            </View>
          </Card>
        </View>
        <Text variant="caption" muted style={{ textAlign: 'center' }}>
          This points directly at the target. Trails, cliffs and water may not follow it, and the
          time ignores climbs.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, paddingTop: 0, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  compass: { alignItems: 'center', gap: space.xs, paddingVertical: space.lg },
  ring: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  north: { position: 'absolute', top: space.sm, fontWeight: '700' },
  metrics: { flexDirection: 'row', gap: space.md },
});
