import React, { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { formatBytes } from '../../domain/geo';
import { describeAccuracy, gpsStatus } from '../../domain/location/fix';
import {
  PERMISSION_COPY,
  effectivePermission,
  permissionAction,
} from '../../domain/location/permission';
import { LATEST_VERSION, currentVersion } from '../../data/migrations';
import { useLocationStore } from '../../platform/locationStore';
import { MAX_RADIUS_M, MIN_RADIUS_M } from '../../domain/adventures/arrival';
import { useCheckpointRadius, useMarkers, useNavPrefs, useRegions } from '../../runtime/hooks';
import { useServices } from '../../runtime/services';
import { AppLogo } from '../../ui/AppLogo';
import { config } from '../../shared/config';
import { setDebugPositions } from '../../shared/logger';
import { perf } from '../../shared/perf';
import {
  Badge,
  Button,
  Card,
  Divider,
  Row,
  Screen,
  SegmentedTabs,
  Text,
} from '../../ui/components';
import { MAX_PACE_KMH, MIN_PACE_KMH } from '../../domain/geo/pace';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow } from '../../ui/useNow';
import { OSM_ATTRIBUTION } from '../../shared/attribution';

const APP_VERSION = '0.1.0 (phase 1)';

export function SettingsScreen({ navigation }: { navigation?: { goBack: () => void } } = {}) {
  const { c } = useTheme();
  const { location, packs, kv, db } = useServices();
  const regions = useRegions();
  const markers = useMarkers();
  const fix = useLocationStore(s => s.fix);
  const raw = useLocationStore(s => s.permission);
  const watchingSince = useLocationStore(s => s.watchingSince);
  const lastError = useLocationStore(s => s.lastError);
  const permission = effectivePermission(raw, fix?.accM ?? null);
  const now = useNow();
  const gps = gpsStatus(now, fix, permission, watchingSince);
  const action = permissionAction(permission);
  const { paceKmh, units, setPace, setUnits } = useNavPrefs();
  const { radiusM, setRadius } = useCheckpointRadius();

  const [usage, setUsage] = useState<Awaited<ReturnType<typeof packs.storageUsage>> | null>(null);
  const [dbVersion, setDbVersion] = useState<number | null>(null);
  const [debugPos, setDebugPos] = useState(false);
  const [catalogUrl, setCatalogUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setUsage(await packs.storageUsage());
    setDbVersion(await currentVersion(db));
    setDebugPos((await kv.get('debug.positions')) === '1');
    const u = await kv.get('catalog.url');
    setSavedUrl(u);
    setCatalogUrl(u ?? config.defaultCatalogUrl ?? '');
  }, [db, kv, packs]);

  useEffect(() => {
    void load();
    void location.refreshPermission();
  }, [load, location]);

  return (
    <Screen title="Settings" onBack={navigation && (() => navigation.goBack())}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ gap: space.sm }}>
          <Row>
            <Text variant="heading" style={{ flex: 1 }}>
              {PERMISSION_COPY[permission].title}
            </Text>
            <Badge
              tone={permission === 'granted' ? 'good' : 'warn'}
              label={permission.replace('_', ' ')}
            />
          </Row>
          <Text muted>{PERMISSION_COPY[permission].body}</Text>
          {action !== 'none' ? (
            <Button
              label={action === 'request' ? 'Allow location' : 'Open system Settings'}
              onPress={() =>
                action === 'request'
                  ? void location.requestPermission()
                  : void location.openSettings()
              }
              testID="permission-action"
            />
          ) : null}
          <Text variant="caption" muted>
            Used only while the app is open. Never sent anywhere.
          </Text>
        </Card>

        <Card style={{ gap: space.sm }} testID="nav-prefs">
          <Text variant="cardTitle">Navigation</Text>
          <SegmentedTabs
            value={units}
            onChange={setUnits}
            options={[
              { value: 'metric', label: 'Metric (km)' },
              { value: 'imperial', label: 'Imperial (mi)' },
            ]}
          />
          <Row>
            <Text style={{ flex: 1 }}>{`Walking pace: ${paceKmh} km/h`}</Text>
            <Button
              small
              variant="secondary"
              label="−"
              disabled={paceKmh <= MIN_PACE_KMH}
              onPress={() => setPace(paceKmh - 0.5)}
              testID="pace-down"
            />
            <Button
              small
              variant="secondary"
              label="+"
              disabled={paceKmh >= MAX_PACE_KMH}
              onPress={() => setPace(paceKmh + 0.5)}
              testID="pace-up"
            />
          </Row>
          <Text variant="caption" muted>
            For time estimates, on flat ground.
          </Text>
        </Card>

        <Card style={{ gap: space.sm }} testID="adventure-prefs">
          <Text variant="cardTitle">Adventures</Text>
          <Row>
            <Text style={{ flex: 1 }}>{`Arrival radius: ${radiusM} m`}</Text>
            <Button
              small
              variant="secondary"
              label="−"
              disabled={radiusM <= MIN_RADIUS_M}
              onPress={() => setRadius(radiusM - 5)}
              testID="radius-down"
            />
            <Button
              small
              variant="secondary"
              label="+"
              disabled={radiusM >= MAX_RADIUS_M}
              onPress={() => setRadius(radiusM + 5)}
              testID="radius-up"
            />
          </Row>
          <Text variant="caption" muted>
            How close counts as arrived. You can always mark it yourself.
          </Text>
        </Card>

        <Card style={{ gap: space.xs }}>
          <Text variant="cardTitle">Offline maps</Text>
          <Text variant="heading">
            {usage ? formatBytes(usage.regionsBytes + usage.partialBytes + usage.styleBytes) : '…'}{' '}
            used
          </Text>
          <Text muted variant="caption">
            {usage
              ? `${
                  regions.filter(r => r.state === 'installed').length
                } installed regions · ${formatBytes(usage.freeBytes)} free on device`
              : ''}
          </Text>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="cardTitle">Diagnostics</Text>
          <Kv k="GPS" v={gps} />
          <Kv k="Last fix accuracy" v={fix ? describeAccuracy(fix.accM) : '-'} />
          <Kv
            k="Last fix age"
            v={fix ? `${Math.max(0, Math.round((now - fix.fixAt) / 1000))} s` : '-'}
          />
          <Kv k="Location error" v={lastError ?? 'none'} />
          <Kv k="Saved markers" v={String(markers.length)} />
          <Kv k="Regions (all states)" v={String(regions.length)} />
          <Kv
            k="Database"
            v={dbVersion === null ? '-' : `schema v${dbVersion} / v${LATEST_VERSION}`}
          />
          <Kv
            k="Start to map style loaded"
            v={
              perf.get('map.styleLoaded') !== undefined
                ? `${perf.get('map.styleLoaded')} ms`
                : 'not yet'
            }
          />
          <Divider />
          <Row>
            <Text style={{ flex: 1 }}>Log positions (debug)</Text>
            <Switch
              value={debugPos}
              onValueChange={async v => {
                setDebugPos(v);
                setDebugPositions(v);
                await kv.set('debug.positions', v ? '1' : '0');
              }}
            />
          </Row>
          <Text variant="caption" muted>
            When off, logs never contain coordinates.
          </Text>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Text variant="cardTitle">Map catalog address</Text>
          <TextInput
            value={catalogUrl}
            onChangeText={setCatalogUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://… (none configured)"
            placeholderTextColor={c.textMuted}
            accessibilityLabel="Map catalog address"
            style={[styles.input, { color: c.text, borderColor: c.border }]}
          />
          <Row>
            <Button
              small
              variant="secondary"
              label="Save"
              onPress={async () => {
                await kv.set('catalog.url', catalogUrl.trim());
                setSavedUrl(catalogUrl.trim());
              }}
            />
            <Button
              small
              variant="ghost"
              label="Reset"
              onPress={async () => {
                await kv.delete('catalog.url');
                setSavedUrl(null);
                setCatalogUrl(config.defaultCatalogUrl ?? '');
              }}
            />
          </Row>
          <Text variant="caption" muted>
            {savedUrl
              ? 'Using a custom address.'
              : config.defaultCatalogUrl
              ? 'Using the development default.'
              : 'No server configured: the built-in list is used.'}{' '}
            This is the only network address the app ever contacts, and only when you open Download
            maps.
          </Text>
        </Card>

        <Card style={{ gap: space.sm }} testID="about">
          <Text variant="cardTitle">About</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <AppLogo size={44} />
            <Text variant="heading">Muster {APP_VERSION}</Text>
          </View>
          <Text>{OSM_ATTRIBUTION}</Text>
          <Text variant="caption" muted>
            Map data is from OpenStreetMap, available under the Open Database Licence. Basemap
            design and tile builds by Protomaps (CC0 design, BSD-3 code). Map rendering by MapLibre
            (BSD-3). Labels use Noto Sans (SIL Open Font Licence).
          </Text>
          <Button
            small
            variant="ghost"
            label="OpenStreetMap copyright"
            onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Text muted>{k}</Text>
      <Text variant="mono" style={{ flexShrink: 1, textAlign: 'right' }}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, paddingTop: space.sm, gap: space.md },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    padding: space.md,
    minHeight: 52,
    fontSize: 15,
  },
});
