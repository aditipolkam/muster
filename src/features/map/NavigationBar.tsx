import React from 'react';
import { StyleSheet, View } from 'react-native';
import { bearingDeg, distanceM } from '../../domain/geo';
import {
  cardinal16Of,
  etaMinutes,
  formatDistanceIn,
  formatEta,
  Units,
} from '../../domain/geo/pace';
import { Fix, usableHeading } from '../../domain/location/fix';
import { Badge, Text } from '../../ui/components';
import { floating, radius, space, tabular, useTheme } from '../../ui/theme';
import { DirectionTile, NavControls, NavView } from '../../ui/trail';

export type NavTarget = {
  name: string;
  lat: number;
  lon: number;
  kind?: 'meeting' | 'marker' | 'checkpoint' | 'pin';
  key?: string;
};

/**
 * Navigating on the map: a dark instruction card at the top (direction, distance, heading and
 * time), an amber reminder that it is a straight line, and the controls at the bottom. The
 * dashed line itself is drawn by the map.
 */
export function NavigationBar({
  target,
  fix,
  heading,
  units,
  paceKmh,
  top,
  bottom,
  onView,
  onEnd,
}: {
  target: NavTarget;
  fix: Fix | null;
  heading: number | null;
  units: Units;
  paceKmh: number;
  top: number;
  bottom: number;
  onView: (v: NavView) => void;
  onEnd: () => void;
}) {
  const { c } = useTheme();
  const dist = fix ? distanceM(fix, target) : null;
  const brg = fix ? bearingDeg(fix, target) : null;
  const h = usableHeading(heading);
  const minutes = etaMinutes(dist, paceKmh);
  return (
    <>
      <View style={[styles.top, { top }]} pointerEvents="box-none">
        <View
          style={[styles.card, floating(c), { backgroundColor: c.ink }]}
          testID="nav-instruction"
        >
          <DirectionTile dark deg={brg === null ? null : h === undefined ? brg : brg - h} />
          <View style={{ flex: 1 }}>
            <Text variant="metric" color={c.onInk} style={tabular} testID="navigation-distance">
              {dist === null ? '–' : formatDistanceIn(dist, units)}
            </Text>
            <Text variant="caption" color={c.onInkMuted} numberOfLines={1}>
              {brg === null
                ? 'Waiting for GPS'
                : `Head ${cardinal16Of(brg)} · ${Math.round(brg)}° · ~${formatEta(minutes)}`}
            </Text>
          </View>
        </View>
        <View style={{ alignSelf: 'flex-start' }}>
          <Badge tone="warn" icon="warning" label="Straight line, not a trail route" />
        </View>
      </View>
      <View
        style={[
          styles.panel,
          floating(c),
          { backgroundColor: c.surface, borderColor: c.border, paddingBottom: bottom + space.lg },
        ]}
        testID="navigation-bar"
      >
        <NavControls
          name={target.name}
          subtitle={
            target.kind === 'meeting'
              ? 'Meeting point'
              : target.kind === 'marker'
              ? 'Saved place'
              : target.kind === 'checkpoint'
              ? 'Checkpoint'
              : 'Pin on the map'
          }
          view="map"
          onView={onView}
          onEnd={onEnd}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: space.md, right: space.md, gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.gutter,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
  },
});
