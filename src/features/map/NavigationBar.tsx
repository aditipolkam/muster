import React from 'react';
import { StyleSheet, View } from 'react-native';
import { bearingDeg, distanceM } from '../../domain/geo';
import { formatDistanceIn, Units } from '../../domain/geo/pace';
import { Fix } from '../../domain/location/fix';
import { Button, Row, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

export type NavTarget = { name: string; lat: number; lon: number };

/** Shown while guiding to a target: the line itself is on the map, this is the one control. */
export function NavigationBar({
  target,
  fix,
  units,
  onEnd,
}: {
  target: NavTarget;
  fix: Fix | null;
  units: Units;
  onEnd: () => void;
}) {
  const { c } = useTheme();
  const dist = fix ? distanceM(fix, target) : null;
  const brg = fix ? bearingDeg(fix, target) : null;
  return (
    <View
      style={[styles.bar, { backgroundColor: c.surface, borderColor: c.border }]}
      testID="navigation-bar"
    >
      <Row>
        <View style={{ flex: 1 }}>
          <Text variant="cardTitle" numberOfLines={1}>
            {target.name}
          </Text>
          <Text variant="caption" muted testID="navigation-distance">
            {dist === null || brg === null
              ? 'Waiting for GPS'
              : `${formatDistanceIn(dist, units)} · ${Math.round(
                  brg,
                )}° · straight line, terrain not considered`}
          </Text>
        </View>
        <Button small variant="secondary" label="End" onPress={onEnd} testID="navigation-end" />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    padding: space.md,
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
