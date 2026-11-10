import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { bearingDeg, distanceM, formatCoord, formatDistance } from '../../domain/geo';
import { Fix, GpsStatus } from '../../domain/location/fix';
import { Marker, MARKER_NAME_MAX } from '../../domain/markers/marker';
import { Button, Row, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassPoint = (deg: number) => COMPASS[Math.round(deg / 45) % 8] ?? 'N';

type Props = {
  marker: Marker;
  fix: Fix | null;
  gps: GpsStatus;
  onRename: (name: string) => void;
  onMove: () => void;
  onDelete: () => void;
  onNavigate: () => void;
  onClose: () => void;
};

export function MarkerSheet({
  marker,
  fix,
  gps,
  onRename,
  onMove,
  onDelete,
  onNavigate,
  onClose,
}: Props) {
  const { c } = useTheme();
  const [name, setName] = useState(marker.name);
  useEffect(() => setName(marker.name), [marker.id, marker.name]);

  const dist = fix ? distanceM(fix, marker) : null;
  const brg = fix ? bearingDeg(fix, marker) : null;

  return (
    <View
      style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]}
      testID="marker-sheet"
    >
      <Row>
        <TextInput
          testID="marker-name"
          value={name}
          maxLength={MARKER_NAME_MAX}
          onChangeText={setName}
          onEndEditing={() => name.trim() && name !== marker.name && onRename(name.trim())}
          accessibilityLabel="Marker name"
          style={[styles.name, { color: c.text, borderColor: c.border }]}
          returnKeyType="done"
        />
        <Button small variant="ghost" label="Close" onPress={onClose} />
      </Row>
      <Text variant="mono" testID="marker-coords" selectable>
        {formatCoord(marker)}
      </Text>
      <Text variant="mono" muted>
        {`${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)}`}
      </Text>
      <Text testID="marker-distance">
        {dist === null || brg === null
          ? gps === 'unavailable'
            ? 'Distance unavailable: location is off'
            : 'Distance unavailable: waiting for GPS'
          : `${formatDistance(dist)} straight line, ${Math.round(brg)}° ${compassPoint(brg)}${
              gps === 'lost' ? ' (from last known position)' : ''
            }`}
      </Text>
      <Button
        style={{ marginTop: space.sm }}
        label="Navigate"
        icon="navigate"
        onPress={onNavigate}
        testID="marker-navigate"
      />
      <Row>
        <Button
          style={{ flex: 1 }}
          variant="secondary"
          label="Move"
          onPress={onMove}
          testID="marker-move"
        />
        <Button
          style={{ flex: 1 }}
          variant="danger"
          label="Delete"
          onPress={onDelete}
          testID="marker-delete"
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
  name: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
