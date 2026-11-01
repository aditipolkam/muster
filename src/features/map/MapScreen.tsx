import type { CameraRef, MapRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BBox } from '../../domain/geo';
import { fixToLatLon, gpsStatus, GpsStatus, describeAccuracy } from '../../domain/location/fix';
import {
  PERMISSION_COPY,
  canTrackLocation,
  effectivePermission,
  permissionAction,
} from '../../domain/location/permission';
import { defaultMarkerName } from '../../domain/markers/marker';
import { covers, needsRegionBanner, selectActiveRegions } from '../../domain/maps/coverage';
import { useLocationStore } from '../../platform/locationStore';
import {
  useGroups,
  useMarkers,
  useMesh,
  useRegions,
  useVisibleMeetingPoints,
} from '../../runtime/hooks';
import { RootTabParamList } from '../../runtime/navigation';
import { useServices } from '../../runtime/services';
import { createLogger } from '../../shared/logger';
import { OSM_ATTRIBUTION } from '../../shared/attribution';
import { perf } from '../../shared/perf';
import { useNow } from '../../ui/useNow';
import { Banner, Card, IconButton, IconTile, ListRow, StatusPill, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';
import { MapCanvas } from './MapCanvas';
import { AreaDownloadSheet } from './AreaDownloadSheet';
import { PlaceSearchSheet } from './PlaceSearchSheet';
import { MarkerSheet } from './MarkerSheet';
import { MeetingDraft, MeetingPointEditor } from './MeetingPointEditor';
import { MeetingPointSheet } from './MeetingPointSheet';
import { buildStyle } from './StyleBuilder';
import {
  accuracyCircle,
  headingCone,
  markersCollection,
  meetingPointKey,
  meetingPointsCollection,
  mePuck,
  metresPerPixel,
} from './overlays';

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
  const { style, points, location, packs, groups: groupService } = useServices();
  const markers = useMarkers();
  const meetingPoints = useVisibleMeetingPoints();
  const groupList = useGroups();
  const myAddress = useMesh().localAddress;
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
    bounds: BBox | null;
  } | null>(null);
  const [areaOpen, setAreaOpen] = useState(false);
  const [areaBbox, setAreaBbox] = useState<BBox | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [onlineUri, setOnlineUri] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [movingMeeting, setMovingMeeting] = useState(false);
  const [draft, setDraft] = useState<MeetingDraft | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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
  // Until a downloaded map covers the view, stream the planet archive so there is something to see.
  useEffect(() => {
    void packs.onlineSource().then(src => setOnlineUri(src?.uri ?? null));
  }, [packs, allRegions.length]);
  // Snapshot the bounds on open so the size check is not restarted by later camera updates.
  const openArea = useCallback(() => {
    setAreaBbox(view?.bounds ?? null);
    setAreaOpen(true);
  }, [view?.bounds]);
  const useOnline = !!onlineUri && !covers(installed, center);
  const mapStyle = useMemo(() => {
    const ids = activeKey ? activeKey.split(',') : [];
    const regions = ids
      .map(id => installed.find(r => r.id === id))
      .filter((r): r is NonNullable<typeof r> => !!r && !!r.filePath)
      .map(r => ({ id: r.id, uri: r.filePath as string }));
    return buildStyle({
      styleRoot: style.styleRoot,
      worldBaseUri: style.worldBaseUri,
      regions,
      onlineUri: useOnline ? onlineUri ?? undefined : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, installed.length, style.styleRoot, style.worldBaseUri, useOnline, onlineUri]);

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
      !route.params?.focusMeetingPoint &&
      !route.params?.focusRegionId
    ) {
      autoCentered.current = true;
      cameraRef.current?.flyTo({
        center: [fix.lon, fix.lat],
        zoom: FOLLOW_ZOOM - 1,
        duration: 600,
      });
    }
  }, [
    mapReady,
    fix,
    route.params?.focusMarkerId,
    route.params?.focusMeetingPoint,
    route.params?.focusRegionId,
  ]);

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
    const mpk = route.params?.focusMeetingPoint;
    const key = `${id ?? ''}|${rid ?? ''}|${mpk ?? ''}|${route.params?.nonce ?? ''}`;
    if (key === '|||' || handledFocus.current === key) {
      return;
    }
    const m = id ? markers.find(x => x.id === id) : undefined;
    const r = rid ? installed.find(x => x.id === rid) : undefined;
    const mp = mpk ? meetingPoints.find(x => meetingPointKey(x) === mpk) : undefined;
    if (!m && !r && !mp) {
      return;
    }
    handledFocus.current = key;
    if (mp) {
      setMode('free');
      setSelectedId(null);
      setSelectedMeeting(mpk ?? null);
      cameraRef.current?.flyTo({ center: [mp.lon, mp.lat], zoom: 16, duration: 800 });
    }
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
    route.params?.focusMeetingPoint,
    route.params?.nonce,
    markers,
    meetingPoints,
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

  const selectedPoint = meetingPoints.find(p => meetingPointKey(p) === selectedMeeting) ?? null;
  const selectedGroup = groupList.find(g => g.id === selectedPoint?.groupId) ?? null;
  useEffect(() => {
    if (selectedMeeting && !selectedPoint) {
      setSelectedMeeting(null);
      setMovingMeeting(false);
    }
  }, [selectedMeeting, selectedPoint]);

  const onRegionChange = useCallback((e: ViewStateChangeEvent) => {
    setView({
      center: [e.center[0], e.center[1]],
      zoom: e.zoom,
      bearing: e.bearing,
      bounds: e.bounds
        ? [
            Math.max(-180, e.bounds[0]),
            Math.max(-85, e.bounds[1]),
            Math.min(180, e.bounds[2]),
            Math.min(85, e.bounds[3]),
          ]
        : null,
    });
    if (e.userInteraction) {
      userMoved.current = true;
    }
    if (e.userInteraction && modeRef.current !== 'free') {
      setMode('free');
    }
  }, []);

  const addMarker = useCallback(
    async ([lon, lat]: [number, number]) => {
      if (moving || movingMeeting) {
        return;
      }
      try {
        const m = await points.create({ name: defaultMarkerName(markers), lat, lon });
        setSelectedId(m.id);
        setSelectedMeeting(null);
      } catch (e) {
        log.warn(`could not create marker: ${String(e)}`);
        Alert.alert('Could not save marker', 'The marker could not be saved to this device.');
      }
    },
    [markers, moving, movingMeeting, points],
  );

  // Long-press: an organizer chooses between a personal marker and a meeting point for the group.
  const organized = groupList.filter(g => g.role === 'organizer' && g.status === 'active');
  const onLongPress = useCallback(
    ([lon, lat]: [number, number]) => {
      if (moving || movingMeeting) {
        return;
      }
      if (organized.length === 0) {
        void addMarker([lon, lat]);
        return;
      }
      Alert.alert('Add to the map', 'What is this place?', [
        ...organized.slice(0, 2).map(g => ({
          text: `Meeting point: ${g.name}`,
          onPress: () => {
            setDraftError(null);
            setDraft({ groupId: g.id, groupName: g.name, name: '', note: '', lat, lon });
          },
        })),
        { text: 'Personal marker', onPress: () => void addMarker([lon, lat]) },
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [addMarker, moving, movingMeeting, organized],
  );

  const submitDraft = useCallback(
    async (d: MeetingDraft) => {
      setDraftBusy(true);
      setDraftError(null);
      const r = await groupService.publishPoint(
        d.groupId,
        { name: d.name, note: d.note || null, lat: d.lat, lon: d.lon },
        d.pointId,
      );
      setDraftBusy(false);
      if (!r.ok) {
        setDraftError(r.error.userMessage);
        return;
      }
      setDraft(null);
      setSelectedId(null);
      setSelectedMeeting(meetingPointKey(r.value.point));
      setInfo(
        r.value.delivered
          ? 'Meeting point shared.'
          : 'Saved. Members receive it when they are in range of you.',
      );
    },
    [groupService],
  );

  const confirmMoveMeeting = useCallback(async () => {
    if (!selectedPoint) {
      return;
    }
    const ctr = await mapRef.current?.getCenter();
    setMovingMeeting(false);
    if (ctr) {
      const r = await groupService.publishPoint(
        selectedPoint.groupId,
        { name: selectedPoint.name, note: selectedPoint.note, lat: ctr[1], lon: ctr[0] },
        selectedPoint.id,
      );
      setInfo(
        !r.ok
          ? r.error.userMessage
          : r.value.delivered
          ? 'Meeting point moved.'
          : 'Saved. Members receive it when they are in range of you.',
      );
    }
  }, [groupService, selectedPoint]);

  const confirmRemoveMeeting = useCallback(() => {
    if (!selectedPoint) {
      return;
    }
    Alert.alert(
      'Remove meeting point?',
      `"${selectedPoint.name}" disappears from every member's map.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void groupService.removePoint(selectedPoint.groupId, selectedPoint.id);
            setSelectedMeeting(null);
          },
        },
      ],
    );
  }, [groupService, selectedPoint]);

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
  const meetingData = useMemo(() => meetingPointsCollection(meetingPoints), [meetingPoints]);

  const activeGroup = groupList.find(g => g.status === 'active') ?? null;
  const meshSnap = useMesh();
  const sheetOpen = !!(selected || selectedPoint || moving || movingMeeting);
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
        meetingPoints={meetingData}
        selectedMeetingKey={selectedMeeting}
        onMeetingPointPress={key => {
          setSelectedMeeting(key);
          setSelectedId(null);
          setMoving(false);
          setMovingMeeting(false);
        }}
        selectedMarkerId={selectedId}
        mapRef={mapRef}
        cameraRef={cameraRef}
        onLongPress={onLongPress}
        onMarkerPress={id => {
          setSelectedId(id);
          setMoving(false);
        }}
        onMapPress={() => {
          if (!moving && !movingMeeting) {
            setSelectedId(null);
            setSelectedMeeting(null);
          }
        }}
        onRegionChange={onRegionChange}
        onStyleLoaded={() => {
          perf.mark('map.styleLoaded');
          setMapReady(true);
          setStyleFailed(false);
        }}
        onLoadFailed={() => setStyleFailed(true)}
      />

      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <StatusPill label={label.text} tone={label.tone} />
        {useOnline ? (
          <StatusPill label="Online map · not saved" tone="warn" testID="online-pill" />
        ) : null}
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
            actionLabel="Download this area"
            onAction={openArea}
            onDismiss={() => setBannerDismissed(true)}
          />
        ) : null}
        {showFirstRun ? (
          <Banner
            title="No offline maps yet"
            body="Download a region while you have a connection so the map works without one."
            actionLabel="Download this area"
            onAction={openArea}
            onDismiss={() => setBannerDismissed(true)}
          />
        ) : null}
        {info ? <Banner title={info} onDismiss={() => setInfo(null)} /> : null}
        {movingMeeting ? (
          <Banner
            tone="info"
            title="Move meeting point"
            body="Pan the map so the crosshair is on the new position, then confirm. Everyone in the group will see it."
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

      {moving || movingMeeting ? (
        <View style={styles.crosshairWrap} pointerEvents="none">
          <View style={[styles.crossH, { backgroundColor: c.danger }]} />
          <View style={[styles.crossV, { backgroundColor: c.danger }]} />
        </View>
      ) : null}

      <View
        style={[styles.controls, { bottom: sheetOpen ? 250 : activeGroup ? 112 : space.xl }]}
        pointerEvents="box-none"
      >
        <IconButton
          testID="map-search-button"
          icon="search"
          label="Search for a place"
          onPress={() => setSearchOpen(true)}
        />
        <IconButton
          testID="map-download-button"
          icon="download"
          label="Download offline maps"
          onPress={openArea}
        />
        <IconButton
          testID="locate-button"
          icon={mode === 'follow-heading' ? 'follow' : 'locate'}
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
        style={[styles.attribution, { bottom: sheetOpen ? 244 : activeGroup ? 92 : space.sm }]}
        pointerEvents="none"
        testID="attribution"
      >
        <Text variant="caption" color="#16201A" style={styles.attributionText}>
          {OSM_ATTRIBUTION}
        </Text>
      </View>

      {activeGroup && !sheetOpen ? (
        <Card style={styles.groupCard} testID="map-group-card">
          <ListRow
            title={activeGroup.name}
            subtitle={`${meshSnap.lifecycle === 'running' ? 'Connected' : 'Mesh off'}${
              meshSnap.blePeerCount !== null ? ` · ${meshSnap.blePeerCount} nearby` : ''
            }`}
            leading={<IconTile name="group" />}
            chevron
            divider={false}
            onPress={() =>
              navigation.navigate('Groups', {
                screen: 'GroupDetails',
                params: { groupId: activeGroup.id },
              })
            }
          />
        </Card>
      ) : null}

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
      {selectedPoint && !movingMeeting ? (
        <MeetingPointSheet
          point={selectedPoint}
          group={selectedGroup}
          me={myAddress}
          fix={fix}
          onEdit={() => {
            setDraftError(null);
            setDraft({
              groupId: selectedPoint.groupId,
              groupName: selectedGroup?.name ?? '',
              pointId: selectedPoint.id,
              name: selectedPoint.name,
              note: selectedPoint.note ?? '',
              lat: selectedPoint.lat,
              lon: selectedPoint.lon,
            });
          }}
          onMove={() => setMovingMeeting(true)}
          onRemove={confirmRemoveMeeting}
          onAcknowledge={() => {
            void groupService
              .acknowledge(selectedPoint.groupId, selectedPoint.id)
              .then(r =>
                setInfo(
                  !r.ok
                    ? r.error.userMessage
                    : r.value
                    ? 'The organizer has been told.'
                    : 'Saved. It is sent when you are in range of the organizer.',
                ),
              );
          }}
          onDetails={() =>
            navigation.navigate('Groups', {
              screen: 'MeetingPoint',
              params: { groupId: selectedPoint.groupId, pointId: selectedPoint.id },
            })
          }
          onClose={() => setSelectedMeeting(null)}
        />
      ) : null}
      {selectedPoint && movingMeeting ? (
        <View style={[styles.moveBar, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <IconButton icon="close" label="Cancel move" onPress={() => setMovingMeeting(false)} />
            <View style={{ flex: 1 }} />
            <IconButton
              icon="check"
              label="Set meeting point here"
              onPress={() => void confirmMoveMeeting()}
              active
            />
          </View>
        </View>
      ) : null}
      <PlaceSearchSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={place => {
          setSearchOpen(false);
          cameraRef.current?.fitBounds(place.bbox, { duration: 800 });
          setAreaBbox(place.bbox);
          setAreaOpen(true);
        }}
      />
      <AreaDownloadSheet
        visible={areaOpen}
        bbox={areaBbox}
        onClose={() => {
          setAreaOpen(false);
          setAreaBbox(null);
        }}
        onBrowse={() => {
          setAreaOpen(false);
          navigation.navigate('More', { screen: 'Download' });
        }}
        onStarted={name => {
          setAreaOpen(false);
          setAreaBbox(null);
          setInfo(`Downloading "${name}". Follow progress in More > Offline maps.`);
        }}
      />
      <MeetingPointEditor
        draft={draft}
        busy={draftBusy}
        error={draftError}
        onSubmit={d => void submitDraft(d)}
        onCancel={() => setDraft(null)}
      />
      {selected && moving ? (
        <View style={[styles.moveBar, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <IconButton icon="close" label="Cancel move" onPress={() => setMoving(false)} />
            <View style={{ flex: 1 }} />
            <IconButton
              icon="check"
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
  groupCard: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    paddingVertical: space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
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
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
