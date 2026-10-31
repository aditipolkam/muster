import type { CameraRef, MapRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fixToLatLon, gpsStatus, GpsStatus, describeAccuracy } from '../../domain/location/fix';
import {
  PERMISSION_COPY,
  canTrackLocation,
  effectivePermission,
  permissionAction,
} from '../../domain/location/permission';
import { defaultMarkerName } from '../../domain/markers/marker';
import { needsRegionBanner, selectActiveRegions } from '../../domain/maps/coverage';
import { useLocationStore } from '../../platform/locationStore';
import { useMarkers, useRegions } from '../../runtime/hooks';
import { RootTabParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import { createLogger } from '../../shared/logger';
import { OSM_ATTRIBUTION } from '../../shared/attribution';
import { perf } from '../../shared/perf';
import { useNow } from '../../ui/useNow';
import { Badge, Banner, IconButton, Text } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';
import { MapCanvas } from './MapCanvas';
import { MarkerSheet } from './MarkerSheet';
import { buildStyle } from './StyleBuilder';
import { accuracyCircle, headingCone, markersCollection, mePuck, metresPerPixel } from './overlays';

const log = createLogger('map');
const MAX_ACTIVE_REGIONS = 3;
const FOLLOW_ZOOM = 15;

type CameraMode = 'free' | 'follow' | 'follow-heading';
type Props = BottomTabScreenProps<RootTabParamList, 'Map'>;

function gpsLabel(
  status: GpsStatus,
  accM: number | null,
  ageS: number | null,
): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  switch (status) {
    case 'unavailable':
      return { text: 'Location off', tone: 'bad' };
    case 'acquiring':
      return { text: 'Acquiring GPS…', tone: 'warn' };
    case 'ok':
      return { text: `GPS ${describeAccuracy(accM ?? NaN)}`, tone: 'good' };
    case 'poor':
      return { text: `GPS weak ${describeAccuracy(accM ?? NaN)}`, tone: 'warn' };
    case 'lost':
      return { text: `GPS lost · last fix ${ageS ?? '?'} s ago`, tone: 'bad' };
  }
}

export function MapScreen({ navigation, route }: Props) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { style, points, location } = useServices();
  const markers = useMarkers();
  const allRegions = useRegions();
  const installed = useMemo(
    () => allRegions.filter(r => r.state === 'installed' && r.filePath),
    [allRegions],
  );

  const fix = useLocationStore(s => s.fix);
  const headingDeg = useLocationStore(s => s.headingDeg);
  const rawPermission = useLocationStore(s => s.permission);
  const watchingSince = useLocationStore(s => s.watchingSince);
  const permission = effectivePermission(rawPermission, fix?.accM ?? null);
  const now = useNow();
  const gps = gpsStatus(now, fix, permission, watchingSince);

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const [mode, setMode] = useState<CameraMode>('free');
  const [view, setView] = useState<{
    center: [number, number];
    zoom: number;
    bearing: number;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [styleFailed, setStyleFailed] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Which installed regions are loaded as sources (A-13: capped).
  const center = view
    ? { lat: view.center[1], lon: view.center[0] }
    : fix
    ? fixToLatLon(fix)
    : { lat: 0, lon: 0 };
  const activeKey = selectActiveRegions(installed, center, MAX_ACTIVE_REGIONS)
    .map(r => r.id)
    .join(',');
  const mapStyle = useMemo(() => {
    const ids = activeKey ? activeKey.split(',') : [];
    const regions = ids
      .map(id => installed.find(r => r.id === id))
      .filter((r): r is NonNullable<typeof r> => !!r && !!r.filePath)
      .map(r => ({ id: r.id, uri: r.filePath as string }));
    return buildStyle({ styleRoot: style.styleRoot, worldBaseUri: style.worldBaseUri, regions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, installed.length, style.styleRoot, style.worldBaseUri]);

  // Initial camera: last fix, else first installed region, else world.
  const initial = useMemo(() => {
    if (fix) {
      return { center: [fix.lon, fix.lat] as [number, number], zoom: FOLLOW_ZOOM };
    }
    const r = installed[0];
    if (r) {
      return {
        center: [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2] as [number, number],
        zoom: 9,
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Centre once on the first fix after launch, unless the user already moved the map or a
  // deep link asked for somewhere else.
  const [mapReady, setMapReady] = useState(false);
  const autoCentered = useRef(false);
  const userMoved = useRef(false);
  useEffect(() => {
    if (
      mapReady &&
      fix &&
      !autoCentered.current &&
      !userMoved.current &&
      !route.params?.focusMarkerId &&
      !route.params?.focusRegionId
    ) {
      autoCentered.current = true;
      cameraRef.current?.flyTo({
        center: [fix.lon, fix.lat],
        zoom: FOLLOW_ZOOM - 1,
        duration: 600,
      });
    }
  }, [mapReady, fix, route.params?.focusMarkerId, route.params?.focusRegionId]);

  // Follow modes drive the camera imperatively (no React re-render of the map per fix).
  useEffect(() => {
    if (!fix || modeRef.current === 'free') {
      return;
    }
    cameraRef.current?.easeTo({
      center: [fix.lon, fix.lat],
      duration: 500,
      ...(modeRef.current === 'follow-heading' && headingDeg !== null
        ? { bearing: headingDeg }
        : {}),
    });
  }, [fix, headingDeg]);

  // Deep-link from the Saved tab / region list. Applied once per navigation, even if the data
  // it refers to finishes loading after the screen mounted.
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = route.params?.focusMarkerId;
    const rid = route.params?.focusRegionId;
    const key = `${id ?? ''}|${rid ?? ''}|${route.params?.nonce ?? ''}`;
    if (key === '||' || handledFocus.current === key) {
      return;
    }
    const m = id ? markers.find(x => x.id === id) : undefined;
    const r = rid ? installed.find(x => x.id === rid) : undefined;
    if (!m && !r) {
      return;
    }
    handledFocus.current = key;
    if (m) {
      setMode('free');
      setSelectedId(m.id);
      cameraRef.current?.flyTo({ center: [m.lon, m.lat], zoom: 16, duration: 800 });
    }
    if (r) {
      setMode('free');
      cameraRef.current?.fitBounds(r.bbox, {
        duration: 800,
        padding: { top: 80, bottom: 80, left: 40, right: 40 },
      });
    }
  }, [
    route.params?.focusMarkerId,
    route.params?.focusRegionId,
    route.params?.nonce,
    markers,
    installed,
  ]);

  // Re-check permission when returning from system Settings.
  useFocusEffect(
    useCallback(() => {
      void location.start();
      const sub = AppState.addEventListener('change', s => s === 'active' && void location.start());
      return () => sub.remove();
    }, [location]),
  );

  const selected = markers.find(m => m.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && !selected) {
      setSelectedId(null);
      setMoving(false);
    }
  }, [selectedId, selected]);

  const onRegionChange = useCallback((e: ViewStateChangeEvent) => {
    setView({ center: [e.center[0], e.center[1]], zoom: e.zoom, bearing: e.bearing });
    if (e.userInteraction) {
      userMoved.current = true;
    }
    if (e.userInteraction && modeRef.current !== 'free') {
      setMode('free');
    }
  }, []);

  const addMarker = useCallback(
    async ([lon, lat]: [number, number]) => {
      if (moving) {
        return;
      }
      try {
        const m = await points.create({ name: defaultMarkerName(markers), lat, lon });
        setSelectedId(m.id);
      } catch (e) {
        log.warn(`could not create marker: ${String(e)}`);
        Alert.alert('Could not save marker', 'The marker could not be saved to this device.');
      }
    },
    [markers, moving, points],
  );

  const cycleMode = useCallback(() => {
    if (!canTrackLocation(permission) || !fix) {
      return;
    }
    if (mode === 'free') {
      setMode('follow');
      cameraRef.current?.flyTo({
        center: [fix.lon, fix.lat],
        zoom: Math.max(view?.zoom ?? 0, FOLLOW_ZOOM),
        duration: 700,
      });
    } else if (mode === 'follow') {
      setMode('follow-heading');
    } else {
      setMode('free');
      cameraRef.current?.easeTo({ center: [fix.lon, fix.lat], bearing: 0, duration: 400 });
    }
  }, [fix, mode, permission, view?.zoom]);

  const confirmMove = useCallback(async () => {
    if (!selected) {
      return;
    }
    const ctr = await mapRef.current?.getCenter();
    if (ctr) {
      await points.update(selected.id, { lon: ctr[0], lat: ctr[1] });
    }
    setMoving(false);
  }, [points, selected]);

  const confirmDelete = useCallback(() => {
    if (!selected) {
      return;
    }
    Alert.alert('Delete marker?', `"${selected.name}" will be removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void points.delete(selected.id);
          setSelectedId(null);
        },
      },
    ]);
  }, [points, selected]);

  const stale = gps === 'lost';
  const zoom = view?.zoom ?? initial?.zoom ?? 1.5;
  const overlays = useMemo(
    () => ({
      accuracy: accuracyCircle(fix),
      cone: headingCone(fix, headingDeg, metresPerPixel(fix?.lat ?? 0, zoom) * 70),
      puck: mePuck(fix, stale),
    }),
    [fix, headingDeg, stale, zoom],
  );
  const markerData = useMemo(() => markersCollection(markers), [markers]);

  const ageS = fix ? Math.max(0, Math.round((now - fix.fixAt) / 1000)) : null;
  const label = gpsLabel(gps, fix?.accM ?? null, ageS);
  const permAction = permissionAction(permission);
  const showCoverageBanner =
    !bannerDismissed && !!view && needsRegionBanner(installed, center, view.zoom);
  const showFirstRun = !bannerDismissed && installed.length === 0 && !showCoverageBanner;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <MapCanvas
        mapStyle={mapStyle}
        initial={initial}
        me={overlays}
        markers={markerData}
        selectedMarkerId={selectedId}
        mapRef={mapRef}
        cameraRef={cameraRef}
        onLongPress={addMarker}
        onMarkerPress={id => {
          setSelectedId(id);
          setMoving(false);
        }}
        onMapPress={() => !moving && setSelectedId(null)}
        onRegionChange={onRegionChange}
        onStyleLoaded={() => {
          perf.mark('map.styleLoaded');
          setMapReady(true);
          setStyleFailed(false);
        }}
        onLoadFailed={() => setStyleFailed(true)}
      />

      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <Badge label={label.text} tone={label.tone} />
        {permAction !== 'none' ? (
          <Banner
            tone={permission === 'approximate' ? 'warn' : 'info'}
            title={PERMISSION_COPY[permission].title}
            body={PERMISSION_COPY[permission].body}
            actionLabel={permAction === 'request' ? 'Allow' : 'Settings'}
            onAction={() =>
              permAction === 'request'
                ? void location.requestPermission()
                : void location.openSettings()
            }
          />
        ) : null}
        {styleFailed ? (
          <Banner
            tone="error"
            title="Map style failed to load"
            body="Check Settings > Diagnostics for details."
          />
        ) : null}
        {showCoverageBanner ? (
          <Banner
            tone="warn"
            title="No offline map for this area"
            body="Your markers and location still work. Download or import a map for this area."
            actionLabel="Get maps"
            onAction={() => navigation.navigate('Maps', { screen: 'Download' })}
            onDismiss={() => setBannerDismissed(true)}
          />
        ) : null}
        {showFirstRun ? (
          <Banner
            title="No offline maps yet"
            body="Download a region while you have a connection so the map works without one."
            actionLabel="Get maps"
            onAction={() => navigation.navigate('Maps', { screen: 'Download' })}
            onDismiss={() => setBannerDismissed(true)}
          />
        ) : null}
        {moving ? (
          <Banner
            tone="info"
            title="Move marker"
            body="Pan the map so the crosshair is on the new position, then confirm."
          />
        ) : null}
      </View>

      {moving ? (
        <View style={styles.crosshairWrap} pointerEvents="none">
          <View style={[styles.crossH, { backgroundColor: c.danger }]} />
          <View style={[styles.crossV, { backgroundColor: c.danger }]} />
        </View>
      ) : null}

      <View
        style={[styles.controls, { bottom: selected ? 250 : space.xl + 60 }]}
        pointerEvents="box-none"
      >
        <IconButton
          testID="locate-button"
          glyph={mode === 'follow-heading' ? '➤' : '◎'}
          label={
            mode === 'free'
              ? 'Center on my location'
              : mode === 'follow'
              ? 'Follow with heading'
              : 'Stop following'
          }
          active={mode !== 'free'}
          onPress={cycleMode}
        />
      </View>

      <View
        style={[styles.attribution, { bottom: selected ? 244 : space.sm }]}
        pointerEvents="none"
        testID="attribution"
      >
        <Text variant="caption" color="#16201A" style={styles.attributionText}>
          {OSM_ATTRIBUTION}
        </Text>
      </View>

      {selected && !moving ? (
        <MarkerSheet
          marker={selected}
          fix={fix}
          gps={gps}
          onRename={name => void points.update(selected.id, { name })}
          onMove={() => setMoving(true)}
          onDelete={confirmDelete}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      {selected && moving ? (
        <View style={[styles.moveBar, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <IconButton glyph="✕" label="Cancel move" onPress={() => setMoving(false)} />
            <View style={{ flex: 1 }} />
            <IconButton
              glyph="✓"
              label="Set marker here"
              onPress={() => void confirmMove()}
              active
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    gap: space.sm,
    alignItems: 'stretch',
  },
  controls: { position: 'absolute', right: space.md, gap: space.sm },
  attribution: { position: 'absolute', right: space.sm },
  attributionText: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  crosshairWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crossH: { position: 'absolute', width: 36, height: 2 },
  crossV: { position: 'absolute', width: 2, height: 36 },
  moveBar: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.xl,
    padding: space.md,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
