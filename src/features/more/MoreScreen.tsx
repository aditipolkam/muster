import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAdventures, useMarkers, useMesh, useRegions } from '../../runtime/hooks';
import { MoreStackParamList } from '../../runtime/navigation';
import { Card, IconName, IconTile, ListRow, Screen, Text } from '../../ui/components';
import { space } from '../../ui/theme';

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreList'>;

export function MoreScreen({ navigation }: Props) {
  const regions = useRegions();
  const markers = useMarkers();
  const mesh = useMesh();
  const adventures = useAdventures();
  const open = adventures.filter(a => a.status === 'active' || a.status === 'paused').length;
  const installed = regions.filter(r => r.state === 'installed').length;
  const peers = mesh.blePeerCount ?? mesh.peers.length;

  const row = (
    icon: IconName,
    title: string,
    meta: string | undefined,
    to: keyof MoreStackParamList,
    divider = true,
  ) => (
    <ListRow
      key={to}
      title={title}
      divider={divider}
      leading={<IconTile name={icon} />}
      trailing={
        meta ? (
          <Text variant="caption" muted>
            {meta}
          </Text>
        ) : null
      }
      chevron
      onPress={() => navigation.navigate(to as never)}
      testID={`more-${to}`}
    />
  );

  return (
    <Screen title="More">
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.group}>
          {row(
            'trail',
            'Adventures',
            open > 0 ? `${open} in progress` : `${adventures.length} total`,
            'Adventures',
            false,
          )}
        </Card>
        <Card style={styles.group}>
          {row(
            'map',
            'Downloaded maps',
            `${installed} ${installed === 1 ? 'region' : 'regions'}`,
            'Downloaded',
          )}
          {row(
            'pin',
            'Saved locations',
            `${markers.length} ${markers.length === 1 ? 'place' : 'places'}`,
            'Saved',
          )}
          {row('mesh', 'Mesh diagnostics', `${peers} nearby`, 'Mesh', false)}
        </Card>
        <Card style={styles.group}>
          {row('settings', 'Settings', undefined, 'Settings', false)}
        </Card>
        <View style={{ height: space.sm }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, paddingTop: 0, gap: space.md },
  group: { paddingVertical: space.xs },
});
