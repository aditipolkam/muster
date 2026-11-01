import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { bearingDeg, distanceM, formatCoord, formatDistance } from '../../domain/geo';
import { useLocationStore } from '../../platform/locationStore';
import { useMarkers, useVisibleMeetingPoints } from '../../runtime/hooks';
import { RootTabParamList } from '../../runtime/navigation';
import { Card, EmptyState, Icon, IconTile, Screen, Text } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

type Props = BottomTabScreenProps<RootTabParamList, 'Navigate'>;

const WALK_KMH = 4;
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = (deg: number) => CARDINALS[Math.round(deg / 45) % 8]!;

/** Straight-line guidance to a meeting point or saved place; not turn-by-turn. */
export function NavigateScreen({ navigation, route }: Props) {
  const { c } = useTheme();
  const points = useVisibleMeetingPoints();
  const markers = useMarkers();
  const fix = useLocationStore(s => s.fix);
  const heading = useLocationStore(s => s.headingDeg);
  const p = route.params;

  const target = useMemo(() => {
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
  }, [markers, p?.groupId, p?.markerId, p?.pointId, points]);

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
  const minutes = dist === null ? null : Math.max(1, Math.round((dist / 1000 / WALK_KMH) * 60));
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
                : `${formatDistance(dist)} · Bearing ${Math.round(bearing)}°`}
            </Text>
          </View>
        </Card>

        <View
          style={styles.compass}
          accessible
          accessibilityLabel={
            bearing === null
              ? 'Compass unavailable until GPS has a fix'
              : `${target.name} is ${formatDistance(dist!)} towards ${cardinal(bearing)}`
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
            {dist === null ? '–' : formatDistance(dist)}
          </Text>
          <Text muted>{bearing === null ? 'Waiting for GPS' : `towards ${cardinal(bearing)}`}</Text>
        </View>

        <View style={styles.metrics}>
          <Card style={[styles.row, { flex: 1 }]}>
            <Icon name="walk" size={20} color={c.textMuted} />
            <View>
              <Text variant="cardTitle">{minutes === null ? '–' : `~ ${minutes} min`}</Text>
              <Text variant="caption" muted>{`(at ${WALK_KMH} km/h)`}</Text>
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
          Straight-line direction, not turn-by-turn. Trails may not follow it.
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
