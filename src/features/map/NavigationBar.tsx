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
import { radius, space, tabular, useTheme } from '../../ui/theme';
import { DirectionTile, NavControls, NavView } from '../../ui/trail';
import type { RouteFailure } from '../../domain/routing/router';

/** Why there is no trail route, in plain words (shown under the straight-line chip). */
export const NO_ROUTE_TEXT: Record<RouteFailure, string> = {
  no_map: 'Download the map of this area to get a trail route.',
  too_far: 'Too far for a trail route (over 15 km).',
  off_network: 'No path within 250 m of you or the destination.',
  no_route: "The paths here don't connect to the destination.",
  error: 'The trail route could not be worked out.',
};

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
  trail,
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
  /** A walking route was found (metres left along it, and a point a little ahead), or is being looked for. */
  trail?:
    | { remainingM: number; ahead: { lat: number; lon: number } }
    | 'finding'
    | { none: RouteFailure }
    | null;
  top: number;
  bottom: number;
  onView: (v: NavView) => void;
  onEnd: () => void;
}) {
  const { c } = useTheme();
  const route = trail && trail !== 'finding' && 'remainingM' in trail ? trail : null;
  const noRoute = trail && trail !== 'finding' && 'none' in trail ? trail.none : null;
  // Along the route: distance left on it, and head for the next stretch of path.
  const dist = route ? route.remainingM : fix ? distanceM(fix, target) : null;
  const brg = fix ? bearingDeg(fix, route ? route.ahead : target) : null;
  const h = usableHeading(heading);
  const minutes = etaMinutes(dist, paceKmh);
  return (
    <>
      <View style={[styles.top, { top }]} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: c.ink }]} testID="nav-instruction">
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
        <View style={{ alignSelf: 'flex-start' }} testID="nav-route-kind">
          {route ? (
            <Badge
              tone="good"
              icon="trail"
              label={`Via trail · ${formatDistanceIn(route.remainingM, units)}`}
            />
          ) : trail === 'finding' ? (
            <Badge icon="trail" label="Looking for a trail route…" />
          ) : (
            <Badge tone="warn" icon="warning" label="Straight line, not a trail route" />
          )}
        </View>
        {noRoute ? (
          <View style={[styles.reason, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text variant="label" muted testID="nav-route-reason">
              {NO_ROUTE_TEXT[noRoute]}
            </Text>
          </View>
        ) : null}
      </View>
      <View
        style={[
          styles.panel,
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
  reason: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
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
