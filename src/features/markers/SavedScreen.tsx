import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput } from 'react-native';
import { bearingDeg, distanceM, formatCoord, formatDistance } from '../../domain/geo';
import { Marker } from '../../domain/markers/marker';
import { useLocationStore } from '../../platform/locationStore';
import { useMarkers } from '../../runtime/hooks';
import { RootTabParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import { Button, Card, EmptyState, Row, Screen, Text } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

type Props = BottomTabScreenProps<RootTabParamList, 'Saved'>;

export function SavedScreen({ navigation }: Props) {
  const { c } = useTheme();
  const { points } = useServices();
  const markers = useMarkers();
  const fix = useLocationStore(s => s.fix);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const confirmDelete = (m: Marker) =>
    Alert.alert('Delete saved location?', `"${m.name}" will be removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void points.delete(m.id) },
    ]);

  const commitRename = async () => {
    if (editing && editing.name.trim()) {
      await points.update(editing.id, { name: editing.name.trim() });
    }
    setEditing(null);
  };

  return (
    <Screen title="Saved locations">
      <FlatList
        data={markers}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="No saved locations"
            body="Press and hold anywhere on the map to drop a marker. Markers are stored on this device and work without a connection."
            actionLabel="Open map"
            onAction={() => navigation.navigate('Map')}
          />
        }
        renderItem={({ item: m }) => (
          <Card style={{ marginBottom: space.md, gap: space.xs }}>
            {editing?.id === m.id ? (
              <TextInput
                autoFocus
                value={editing.name}
                onChangeText={name => setEditing({ id: m.id, name })}
                onSubmitEditing={() => void commitRename()}
                onEndEditing={() => void commitRename()}
                maxLength={80}
                accessibilityLabel="Marker name"
                style={{
                  color: c.text,
                  fontSize: 18,
                  fontWeight: '600',
                  borderBottomWidth: 1,
                  borderColor: c.border,
                }}
              />
            ) : (
              <Text variant="heading">{m.name}</Text>
            )}
            <Text variant="mono" muted selectable>
              {formatCoord(m)}
            </Text>
            <Text variant="caption" muted>
              {fix
                ? `${formatDistance(distanceM(fix, m))} · ${Math.round(
                    bearingDeg(fix, m),
                  )}° from you`
                : 'Distance unavailable until GPS has a fix'}
            </Text>
            <Row style={{ justifyContent: 'flex-end', marginTop: space.xs }}>
              <Button
                small
                variant="ghost"
                label="Rename"
                onPress={() => setEditing({ id: m.id, name: m.name })}
              />
              <Button small variant="danger" label="Delete" onPress={() => confirmDelete(m)} />
              <Button
                small
                label="Show on map"
                onPress={() =>
                  navigation.navigate('Map', { focusMarkerId: m.id, nonce: Date.now() })
                }
              />
            </Row>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { padding: space.lg, paddingTop: space.sm } });
