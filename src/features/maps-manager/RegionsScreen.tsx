import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { formatBytes } from '../../domain/geo';
import { RegionRecord } from '../../domain/maps/region';
import { useRegions } from '../../runtime/hooks';
import { MapsStackParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import { Badge, Button, Card, EmptyState, Row, Screen, Text } from '../../ui/components';
import { space } from '../../ui/theme';
import { StorageUsage } from './MapPackManager';
import { describeRegionProblem } from './messages';

type Props = NativeStackScreenProps<MapsStackParamList, 'Downloaded'>;

export function RegionsScreen({ navigation }: Props) {
  const { packs, fs } = useServices();
  const regions = useRegions();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    setUsage(await packs.storageUsage());
    const next: Record<string, number> = {};
    for (const r of regions) {
      if (r.filePath) {
        next[r.id] = await fs.size(r.filePath);
      }
    }
    setSizes(next);
  }, [fs, packs, regions]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const installed = regions.filter(r => r.state === 'installed');
  const other = regions.filter(r => r.state !== 'installed');

  const confirmDelete = (r: RegionRecord) =>
    Alert.alert(
      `Delete "${r.name}"?`,
      `This frees ${formatBytes(sizes[r.id] ?? r.bytes)}. You can download it again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void packs.delete(r.id).then(reload),
        },
      ],
    );

  return (
    <Screen
      title="Downloaded maps"
      right={
        <Button
          small
          label="Add maps"
          onPress={() => navigation.navigate('Download')}
          testID="add-maps"
        />
      }
    >
      <FlatList
        data={[...installed, ...other]}
        keyExtractor={r => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          usage ? (
            <Card style={{ marginBottom: space.md, gap: 4 }}>
              <Text variant="label" muted>
                Map storage
              </Text>
              <Text variant="title" testID="storage-total">
                {formatBytes(usage.regionsBytes + usage.partialBytes + usage.styleBytes)}
              </Text>
              <Text variant="caption" muted>
                {`Regions ${formatBytes(usage.regionsBytes)} · partial downloads ${formatBytes(
                  usage.partialBytes,
                )} · base map & fonts ${formatBytes(usage.styleBytes)}`}
              </Text>
              <Text variant="caption" muted>
                {`${formatBytes(usage.freeBytes)} free on this device`}
              </Text>
            </Card>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title="No maps downloaded"
            body="Download a region while you have a connection and it will be available offline, even after you restart the app."
            actionLabel="Download maps"
            onAction={() => navigation.navigate('Download')}
          />
        }
        renderItem={({ item: r }) => {
          const problem = describeRegionProblem(r, usage?.freeBytes ?? null);
          return (
            <Card style={{ marginBottom: space.md, gap: space.sm }}>
              <Row>
                <Text variant="heading" style={{ flex: 1 }}>
                  {r.name}
                </Text>
                {r.state === 'installed' ? (
                  <Badge tone="good" label="Installed" />
                ) : (
                  <Badge
                    tone={r.state === 'failed' ? 'bad' : 'warn'}
                    label={r.state === 'failed' ? 'Failed' : 'Incomplete'}
                  />
                )}
              </Row>
              <Text variant="caption" muted>
                {r.state === 'installed'
                  ? `${formatBytes(sizes[r.id] ?? r.bytes)} on device · zoom ${r.minZoom}-${
                      r.maxZoom
                    } · ${
                      r.source === 'import'
                        ? 'imported file'
                        : `OSM data ${r.osmDataDate ?? 'unknown'}`
                    }${
                      r.installedAt
                        ? ` · added ${new Date(r.installedAt).toLocaleDateString()}`
                        : ''
                    }`
                  : `${formatBytes(r.progressBytes)} of ${formatBytes(r.bytes)}`}
              </Text>
              {problem ? (
                <Text variant="caption" color="#B3261E">
                  {problem}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' }}>
                {r.state === 'installed' ? (
                  <Button
                    small
                    variant="secondary"
                    label="View on map"
                    onPress={() =>
                      navigation
                        .getParent()
                        ?.navigate('Map', { focusRegionId: r.id, nonce: Date.now() })
                    }
                  />
                ) : (
                  <Button
                    small
                    variant="secondary"
                    label="Manage"
                    onPress={() => navigation.navigate('Download')}
                  />
                )}
                <Button
                  small
                  variant="danger"
                  label="Delete"
                  onPress={() => confirmDelete(r)}
                  testID={`delete-${r.id}`}
                />
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { padding: space.lg, paddingTop: space.sm } });
