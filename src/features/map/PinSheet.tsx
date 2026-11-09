import React from 'react';
import { StyleSheet, View } from 'react-native';
import { bearingDeg, distanceM, formatCoord } from '../../domain/geo';
import { formatDistanceIn, Units } from '../../domain/geo/pace';
import { Fix } from '../../domain/location/fix';
import { Button, Row, Text } from '../../ui/components';
import { floating, radius, space, useTheme } from '../../ui/theme';

type Props = {
  pin: { lat: number; lon: number };
  fix: Fix | null;
  units: Units;
  onNavigate: () => void;
  onSave: () => void;
  onClose: () => void;
};

/** A temporary pin dropped by tapping the map. Nothing is saved until the user asks. */
export function PinSheet({ pin, fix, units, onNavigate, onSave, onClose }: Props) {
  const { c } = useTheme();
  const dist = fix ? distanceM(fix, pin) : null;
  const brg = fix ? bearingDeg(fix, pin) : null;
  return (
    <View
      style={[styles.sheet, floating(c), { backgroundColor: c.surface, borderColor: c.border }]}
      testID="pin-sheet"
    >
      <Row>
        <Text variant="cardTitle" style={{ flex: 1 }}>
          Dropped pin
        </Text>
        <Button small variant="ghost" label="Close" onPress={onClose} testID="pin-close" />
      </Row>
      <Text variant="mono" selectable>
        {formatCoord(pin)}
      </Text>
      <Text muted testID="pin-distance">
        {dist === null || brg === null
          ? 'Distance unavailable: waiting for GPS'
          : `${formatDistanceIn(dist, units)} straight line · ${Math.round(brg)}°`}
      </Text>
      <Row style={{ marginTop: space.sm }}>
        <Button
          style={{ flex: 1 }}
          label="Navigate"
          icon="navigate"
          onPress={onNavigate}
          testID="pin-navigate"
        />
        <Button
          style={{ flex: 1 }}
          variant="secondary"
          label="Save"
          onPress={onSave}
          testID="pin-save"
        />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.gutter,
    gap: space.sm,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
  },
});
