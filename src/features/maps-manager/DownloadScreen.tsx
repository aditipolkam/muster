import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { bboxAreaKm2, formatBytes } from '../../domain/geo';
import { RegionEntry } from '../../domain/maps/catalog';
import { RegionRecord } from '../../domain/maps/region';
import { useRegions } from '../../runtime/hooks';
import { MapsStackParamList } from '../../runtime/navigation';
import { usePackStore } from '../../runtime/packStore';
import { useServices } from '../../runtime/services';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Row,
  Screen,
  Text,
} from '../../ui/components';
import { space } from '../../ui/theme';
import { CatalogLoad } from './MapPackManager';
import { describeRegionProblem, formatEta } from './messages';

type Props = NativeStackScreenProps<MapsStackParamList, 'Download'>;

function sourceNote(l: CatalogLoad | null, refreshing: boolean): string {
  if (!l) {
    return refreshing ? 'Checking for map updates…' : '';
  }
  switch (l.source) {
    case 'remote':
      return `Map list updated just now. Data from OpenStreetMap, ${
        l.catalog.regions[0]?.osmDataDate ?? ''
      }.`;
    case 'cache':
      return 'Showing the last downloaded map list. You appear to be offline.';
    case 'bundled':
      return 'Showing the built-in map list. Connect to the internet to check for newer regions.';
  }
}

export function DownloadScreen({ navigation }: Props) {
  const { packs, fs } = useServices();
  const records = useRegions();
  const progress = usePackStore(s => s.progress);
  const [catalog, setCatalog] = useState<CatalogLoad | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [free, setFree] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setCatalog(await packs.loadCatalog({ refresh: true }));
      setFree(await fs.freeBytes());
    } finally {
      setRefreshing(false);
    }
  }, [fs, packs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byId = useMemo(() => new Map(records.map(r => [r.id, r])), [records]);
  const entries = catalog?.catalog.regions ?? [];

  const onImport = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets[0]) {
      return;
    }
    const asset = res.assets[0];
    setImporting(true);
    try {
      const r = await packs.importFile(asset.uri, asset.name);
      if (r.ok) {
        Alert.alert('Map imported', `"${r.value.name}" is ready to use offline.`);
      } else {
        Alert.alert('Could not import this file', r.error.userMessage);
      }
    } finally {
      setImporting(false);
    }
  }, [packs]);

  const confirmDiscard = (r: RegionRecord) =>
    Alert.alert('Discard download?', `The partly downloaded "${r.name}" will be deleted.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void packs.cancel(r.id) },
    ]);

  return (
    <Screen title="Download maps" onBack={() => navigation.goBack()}>
      <FlatList
        data={entries}
        keyExtractor={e => e.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <Text muted variant="caption">
              {sourceNote(catalog, refreshing)}
            </Text>
            {free !== null ? (
              <Text variant="caption" muted>
                {`Free space on this device: ${formatBytes(free)}`}
              </Text>
            ) : null}
            <Button
              variant="secondary"
              label="Import a .pmtiles file from Files"
              loading={importing}
              onPress={() => void onImport()}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No regions available"
            body="The map list is empty. Try again when you are online."
          />
        }
        renderItem={({ item }) => (
          <RegionCard
            entry={item}
            record={byId.get(item.id) ?? null}
            free={free}
            onStart={() => void packs.start(item).then(() => fs.freeBytes().then(setFree))}
            onPause={() => void packs.pause(item.id)}
            onResume={() => void packs.resumeById(item.id)}
            onDiscard={r => confirmDiscard(r)}
            onView={() =>
              navigation.getParent()?.navigate('Map', { focusRegionId: item.id, nonce: Date.now() })
            }
            progress={progress[item.id]}
          />
        )}
      />
    </Screen>
  );
}

function RegionCard({
  entry,
  record,
  free,
  progress,
  onStart,
  onPause,
  onResume,
  onDiscard,
  onView,
}: {
  entry: RegionEntry;
  record: RegionRecord | null;
  free: number | null;
  progress: { phase: string; receivedBytes: number; totalBytes: number; rate: number } | undefined;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onDiscard: (r: RegionRecord) => void;
  onView: () => void;
}) {
  const state = record?.state ?? 'available';
  const received = progress?.receivedBytes ?? record?.progressBytes ?? 0;
  const pct = entry.bytes > 0 ? received / entry.bytes : 0;
  const problem = record ? describeRegionProblem(record, free) : null;
  const eta =
    progress && progress.rate > 0 && state === 'downloading'
      ? formatEta((entry.bytes - received) / progress.rate)
      : '';
  return (
    <Card style={{ marginBottom: space.md, gap: space.sm }}>
      <Row>
        <Text variant="heading" style={{ flex: 1 }}>
          {entry.name}
        </Text>
        {state === 'installed' ? <Badge tone="good" label="Installed" /> : null}
        {state === 'paused' ? <Badge tone="warn" label="Paused" /> : null}
        {state === 'failed' ? <Badge tone="bad" label="Failed" /> : null}
      </Row>
      <Text variant="caption" muted>
        {`${formatBytes(entry.bytes)} · zoom ${entry.minZoom}-${entry.maxZoom} · ~${Math.round(
          bboxAreaKm2(entry.bbox),
        ).toLocaleString()} km² · OSM data ${entry.osmDataDate}`}
      </Text>

      {state === 'downloading' ||
      state === 'verifying' ||
      state === 'paused' ||
      state === 'failed' ? (
        <View style={{ gap: 4 }}>
          <ProgressBar
            value={
              state === 'verifying' ? (progress?.receivedBytes ?? entry.bytes) / entry.bytes : pct
            }
          />
          <Text variant="caption" muted>
            {state === 'verifying'
              ? 'Verifying integrity…'
              : `${formatBytes(received)} of ${formatBytes(entry.bytes)} (${Math.floor(
                  pct * 100,
                )}%) ${eta}`}
          </Text>
        </View>
      ) : null}

      {problem ? <Banner tone={state === 'paused' ? 'warn' : 'error'} title={problem} /> : null}

      <Row style={{ justifyContent: 'flex-end' }}>
        {state === 'available' ? (
          <Button label="Download" onPress={onStart} testID={`download-${entry.id}`} />
        ) : null}
        {state === 'downloading' ? (
          <Button variant="secondary" label="Pause" onPress={onPause} />
        ) : null}
        {state === 'paused' || state === 'failed' ? (
          <>
            {record ? (
              <Button variant="ghost" label="Discard" onPress={() => onDiscard(record)} />
            ) : null}
            <Button
              label={state === 'failed' && record?.progressBytes === 0 ? 'Try again' : 'Resume'}
              onPress={onResume}
              testID={`resume-${entry.id}`}
            />
          </>
        ) : null}
        {state === 'installed' ? (
          <Button variant="secondary" label="View on map" onPress={onView} />
        ) : null}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({ list: { padding: space.lg, paddingTop: space.sm } });
