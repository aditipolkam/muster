import type { CameraRef, MapRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BBox, bboxCenter, bearingDeg, distanceM } from '../../domain/geo';
import { cardinal16Of, formatDistanceIn } from '../../domain/geo/pace';
import { fixToLatLon, gpsStatus } from '../../domain/location/fix';
import {
  canTrackLocation,
  effectivePermission,
  permissionAction,
} from '../../domain/location/permission';
import { defaultMarkerName } from '../../domain/markers/marker';
import { covers, selectActiveRegions } from '../../domain/maps/coverage';
import { useLocationStore } from '../../platform/locationStore';
import {
  useAdventures,
  useGroups,
  useMarkers,
  useMesh,
  useNavPrefs,
  useRegions,
  useVisibleMeetingPoints,
} from '../../runtime/hooks';
import { PickedLocation, RootTabParamList } from '../../runtime/navigation';
import { useNavSession } from '../../runtime/navSession';
import { useServices } from '../../runtime/services';
import { createLogger } from '../../shared/logger';
import { OSM_ATTRIBUTION } from '../../shared/attribution';
import { perf } from '../../shared/perf';
import { useNow } from '../../ui/useNow';
import {
  boxAround,
  boxSideKm,
  DEFAULT_AREA_MAX_ZOOM,
  DEFAULT_AREA_MIN_ZOOM,
  DEFAULT_REGION_SIDE_KM,
  estimateAreaBytes,
} from '../../domain/adventures/area';
import { canEditAdventure } from '../../domain/adventures/authorize';
import { useAdventureMapState } from './AdventureOverlay';
import { Icon, IconButton, StatusPill, Text } from '../../ui/components';
import { radius, size, space, useTheme } from '../../ui/theme';
import { FlagPin } from '../../ui/trail';
import { MapCanvas } from './MapCanvas';
import { AreaDownloadSheet } from './AreaDownloadSheet';
import { PlaceSearchSheet } from './PlaceSearchSheet';
import { MarkerSheet } from './MarkerSheet';
import { MeetingDraft, MeetingPointEditor } from './MeetingPointEditor';
import { MeetingPointSheet } from './MeetingPointSheet';
import { NavigationBar, NavTarget } from './NavigationBar';
import { createTrailRouter, useTrailRoute } from './trailRouter';
import { PickLocationOverlay, PickStep } from './PickLocation';
import { PinSheet } from './PinSheet';
import { buildStyle } from './StyleBuilder';
import {
  accuracyCircle,
  boxCollection,
  guideLine,
  headingCone,
  markersCollection,
  meetingPointKey,
  meetingPointsCollection,
  mePuck,
  metresPerPixel,
  pinCollection,
  routeCollection,
} from './overlays';

const log = createLogger('map');
const MAX_ACTIVE_REGIONS = 3;
const FOLLOW_ZOOM = 15;
/** A trip covers more ground than one phase: start the trip-map square at 10 km. */
const TRIP_MAP_SIDE_KM = 10;
/** A tap on a marker can also reach the map; ignore the map tap that follows it. */
const FEATURE_TAP_GUARD_MS = 350;

type CameraMode = 'free' | 'follow' | 'follow-heading';
type Props = BottomTabScreenProps<RootTabParamList, 'Map'>;

/**
 * The map and nothing else: search, download, an offline-coverage icon and recenter. Everything
 * about groups, mesh and adventures lives in its own tab; selecting something on the map opens a
 * sheet with its actions (including "Start navigation").
 */
export function MapScreen({ navigation, route }: Props) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { style, points, location, packs, groups: groupService, fs } = useServices();
  const markers = useMarkers();
  const meetingPoints = useVisibleMeetingPoints();
  const groupList = useGroups();
  const meshSnap = useMesh();
  const myAddress = meshSnap.localAddress;
  const nearbyCount = meshSnap.peers.filter(x => x.state === 'nearby').length;
  const adventureList = useAdventures();
  const adv = useAdventureMapState(route.params?.showAdventure);
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
  const permAction = permissionAction(permission);
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
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  // Navigation is shared with the Compass view (Map | Compass toggle), so it lives in a store.
  const navTarget = useNavSession(s => s.target) as NavTarget | null;
  const startSession = useNavSession(s => s.start);
  const endSession = useNavSession(s => s.end);
  const setPicking = useNavSession(s => s.setPicking);
  const [mapReady, setMapReady] = useState(false);

  // "Select Location": a place for a phase (and its offline region), or a meeting point to share
  // with a group. Either way the place goes back to the screen that asked.
  const phasePick = route.params?.pick ?? null;
  const meetingPick = route.params?.pickMeeting ?? null;
  const tripPick = route.params?.pickTripMap ?? null;
  const pickReq = useMemo(
    () =>
      phasePick ??
      (meetingPick
        ? { includeRegion: false, region: null, lat: meetingPick.lat, lon: meetingPick.lon }
        : tripPick
        ? {
            includeRegion: true,
            region: tripPick.region ?? null,
            ...(tripPick.region ? bboxCenter(tripPick.region) : {}),
          }
        : null),
    [phasePick, meetingPick, tripPick],
  );
  // Placing a pin is full screen: the tab bar hides meanwhile.
  const picking = !!pickReq;
  useEffect(() => {
    setPicking(picking);
    return () => setPicking(false);
  }, [picking, setPicking]);
  const [pickStep, setPickStep] = useState<PickStep>('pin');
  const [pickPoint, setPickPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [pickSideKm, setPickSideKm] = useState(DEFAULT_REGION_SIDE_KM);
  const pickKey = phasePick
    ? `${phasePick.adventureId}|${phasePick.checkpointId ?? ''}|${route.params?.nonce ?? ''}`
    : meetingPick
    ? `meeting|${meetingPick.groupId}|${route.params?.nonce ?? ''}`
    : tripPick
    ? `trip|${tripPick.groupId}|${route.params?.nonce ?? ''}`
    : null;
  const pickRegion = useMemo(
    () =>
      pickReq?.includeRegion && pickStep === 'region' && pickPoint
        ? boxAround(pickPoint, pickSideKm)
        : null,
    [pickReq?.includeRegion, pickStep, pickPoint, pickSideKm],
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastFeatureTap = useRef(0);

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
  const availableOffline = covers(installed, center);
  const useOnline = !!onlineUri && !availableOffline;
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

  // Deep-link from the Saved tab / region list / a group's meeting point. Applied once per
  // navigation, even if the data it refers to finishes loading after the screen mounted.
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
      setPin(null);
      setSelectedMeeting(mpk ?? null);
      cameraRef.current?.flyTo({ center: [mp.lon, mp.lat], zoom: 16, duration: 800 });
    }
    if (m) {
      setMode('free');
      setSelectedId(m.id);
      setPin(null);
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

  // "Show on map" from an adventure: frame its checkpoints and route once per request.
  const framed = useRef<string | null>(null);
  useEffect(() => {
    const id = route.params?.showAdventure;
    const key = `${id ?? ''}|${route.params?.nonce ?? ''}`;
    if (!id || framed.current === key || !adv.bounds || adv.shownId !== id) {
      return;
    }
    framed.current = key;
    setMode('free');
    cameraRef.current?.fitBounds(adv.bounds, {
      duration: 800,
      padding: { top: 120, bottom: 160, left: 48, right: 48 },
    });
  }, [adv.bounds, adv.shownId, route.params?.showAdventure, route.params?.nonce]);

  // A new request to pick a place starts at the pin step, near the phase's current place.
  useEffect(() => {
    if (!pickKey || !pickReq) {
      return;
    }
    setPickStep('pin');
    setPickPoint(null);
    setPickSideKm(
      pickReq.region
        ? Math.round(boxSideKm(pickReq.region).widthKm)
        : tripPick
        ? TRIP_MAP_SIDE_KM
        : DEFAULT_REGION_SIDE_KM,
    );
    setSelectedId(null);
    setSelectedMeeting(null);
    setPin(null);
    setMode('free');
    if (pickReq.lat !== undefined && pickReq.lon !== undefined) {
      cameraRef.current?.flyTo({ center: [pickReq.lon, pickReq.lat], zoom: 15, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey]);
  useEffect(() => {
    if (pickRegion) {
      cameraRef.current?.fitBounds(pickRegion, {
        duration: 300,
        padding: { top: 160, bottom: 320, left: 40, right: 40 },
      });
    }
  }, [pickRegion]);

  const returnToEditor = useCallback(
    (picked?: PickedLocation) => {
      if (tripPick) {
        navigation.setParams({ pickTripMap: undefined });
        navigation.navigate('Groups', {
          screen: 'GroupInfo',
          params: {
            groupId: tripPick.groupId,
            pickedArea: picked?.region ? { bbox: picked.region, nonce: picked.nonce } : undefined,
          },
        });
        return;
      }
      if (meetingPick) {
        navigation.setParams({ pickMeeting: undefined });
        navigation.navigate('Groups', {
          screen: 'GroupDetails',
          params: {
            groupId: meetingPick.groupId,
            picked: picked ? { lat: picked.lat, lon: picked.lon, nonce: picked.nonce } : undefined,
          },
        });
        return;
      }
      if (!phasePick) {
        return;
      }
      navigation.setParams({ pick: undefined });
      navigation.navigate('Activity', {
        screen: 'CheckpointEditor',
        params: {
          adventureId: phasePick.adventureId,
          checkpointId: phasePick.checkpointId,
          type: phasePick.type,
          picked,
        },
      });
    },
    [navigation, phasePick, meetingPick, tripPick],
  );
  const placePin = () => {
    if (!view) {
      return;
    }
    const at = { lat: view.center[1], lon: view.center[0] };
    if (pickReq?.includeRegion) {
      setPickPoint(at);
      setPickStep('region');
    } else {
      returnToEditor({ ...at, region: null, nonce: Date.now() });
    }
  };
  const confirmPick = () => {
    if (pickPoint) {
      returnToEditor({ ...pickPoint, region: pickRegion, nonce: Date.now() });
    }
  };
  const pickBack = () => {
    if (pickStep === 'region') {
      setPickStep('pin');
      setPickPoint(null);
    } else {
      returnToEditor();
    }
  };

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
    async ([lon, lat]: [number, number], name?: string) => {
      if (moving || movingMeeting) {
        return;
      }
      try {
        const m = await points.create({ name: name ?? defaultMarkerName(markers), lat, lon });
        setPin(null);
        setSelectedId(m.id);
        setSelectedMeeting(null);
      } catch (e) {
        log.warn(`could not create marker: ${String(e)}`);
        Alert.alert('Could not save marker', 'The marker could not be saved to this device.');
      }
    },
    [markers, moving, movingMeeting, points],
  );

  // The adventure a long-press can add a checkpoint to: the one in progress, else a planned one.
  const currentAdventureId = adv.current?.adventure.id;
  const checkpointTarget = useMemo(() => {
    const editable = adventureList.filter(
      a =>
        (a.status === 'planned' || a.status === 'active' || a.status === 'paused') &&
        canEditAdventure(a, groupList.find(g => g.id === a.groupId) ?? null, myAddress),
    );
    return (
      editable.find(a => a.id === currentAdventureId) ??
      editable.find(a => a.status === 'planned') ??
      null
    );
  }, [adventureList, groupList, myAddress, currentAdventureId]);
  const onLongPress = useCallback(
    ([lon, lat]: [number, number]) => {
      if (moving || movingMeeting || pickReq) {
        return;
      }
      // Meeting points are shared from the group page, not from here.
      if (!checkpointTarget) {
        void addMarker([lon, lat]);
        return;
      }
      Alert.alert('Add to the map', 'What is this place?', [
        ...(checkpointTarget
          ? [
              {
                text: `Checkpoint: ${checkpointTarget.name}`,
                onPress: () =>
                  navigation.navigate('Activity', {
                    screen: 'CheckpointEditor',
                    params: { adventureId: checkpointTarget.id, lat, lon },
                  }),
              },
            ]
          : []),
        { text: 'Personal marker', onPress: () => void addMarker([lon, lat]) },
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [addMarker, checkpointTarget, moving, movingMeeting, navigation, pickReq],
  );

  // Tap on empty map: clear a selection, otherwise drop a temporary pin.
  const onMapPress = useCallback(
    ([lon, lat]: [number, number]) => {
      if (
        moving ||
        movingMeeting ||
        pickReq ||
        Date.now() - lastFeatureTap.current < FEATURE_TAP_GUARD_MS
      ) {
        return;
      }
      if (selectedId || selectedMeeting || pin) {
        setSelectedId(null);
        setSelectedMeeting(null);
        setPin(null);
        return;
      }
      setPin({ lat, lon });
    },
    [moving, movingMeeting, pickReq, pin, selectedId, selectedMeeting],
  );

  const startNavigation = useCallback(
    (target: NavTarget) => {
      startSession(target);
      setSelectedId(null);
      setSelectedMeeting(null);
      setPin(null);
    },
    [startSession],
  );
  // Map | Compass: the compass view reads the same session; meeting points and markers are also
  // passed as params so the compass can show their details.
  const openCompass = useCallback(
    (t: NavTarget) => {
      const [groupId, pointId] = t.kind === 'meeting' && t.key ? t.key.split(':') : [];
      navigation.navigate(
        'Navigate',
        groupId && pointId
          ? { groupId, pointId }
          : t.kind === 'marker' && t.key
          ? { markerId: t.key }
          : undefined,
      );
    },
    [navigation],
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
      if (!r.ok) {
        Alert.alert('Could not move the meeting point', r.error.userMessage);
      }
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
      // No usable position yet: ask for permission or send the user to Settings.
      if (permAction === 'request') {
        void location.requestPermission();
      } else if (permAction === 'open_settings') {
        void location.openSettings();
      } else {
        void location.start();
      }
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
  }, [fix, mode, permission, permAction, location, view?.zoom]);

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
  const regionBoxData = useMemo(() => boxCollection(pickRegion), [pickRegion]);
  const markerData = useMemo(() => markersCollection(markers), [markers]);
  const meetingData = useMemo(() => meetingPointsCollection(meetingPoints), [meetingPoints]);
  // Offline walking route (experiment, ADR 0015): along the paths in the downloaded map; the
  // dashed straight line stays until (and unless) one is found.
  const router = useMemo(() => createTrailRouter(fs, installed), [fs, installed]);
  const trail = useTrailRoute(router, navTarget, fix ? { lat: fix.lat, lon: fix.lon } : null);
  const trailData = useMemo(
    () => routeCollection(trail.status === 'ok' ? trail.route.coords : []),
    [trail],
  );
  const guide = useMemo(
    () =>
      guideLine(
        fix && trail.status !== 'ok' ? { lat: fix.lat, lon: fix.lon } : null,
        trail.status === 'ok' ? null : navTarget,
      ),
    [fix, navTarget, trail.status],
  );
  const pinData = useMemo(
    () => pinCollection(pickReq ? (pickStep === 'region' ? pickPoint : null) : pin ?? navTarget),
    [pickReq, pickStep, pickPoint, pin, navTarget],
  );

  const navPrefs = useNavPrefs();
  const sheetOpen = !!(selected || selectedPoint || pin || moving || movingMeeting);
  const bottomClear = pickReq
    ? 250
    : selectedPoint && !movingMeeting
    ? 400
    : sheetOpen
    ? 250
    : navTarget
    ? 250
    : space.sm;
  const pickDistance =
    meetingPick && fix && view
      ? (() => {
          const at = { lat: view.center[1], lon: view.center[0] };
          return `${formatDistanceIn(distanceM(fix, at), navPrefs.units)} ${cardinal16Of(
            bearingDeg(fix, at),
          )} of you`;
        })()
      : null;
  const offlineLabel = availableOffline
    ? 'Available offline'
    : useOnline
    ? 'Online map · not saved'
    : 'No offline map for this area';
  const statusLabel = `${
    availableOffline ? 'Offline' : useOnline ? 'Online map' : 'No map saved'
  } · ${nearbyCount} nearby`;
  const showOffline = () =>
    availableOffline
      ? Alert.alert('Available offline', 'This area is saved on your device.')
      : Alert.alert(
          offlineLabel,
          useOnline
            ? 'Streamed, not saved. Download the area to use it offline.'
            : 'Download this area to use it offline.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Download this area', onPress: openArea },
          ],
        );

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <MapCanvas
        mapStyle={mapStyle}
        initial={initial}
        me={overlays}
        markers={markerData}
        meetingPoints={meetingData}
        checkpoints={adv.checkpoints}
        route={adv.route}
        pulse={adv.pulse}
        guide={guide}
        trail={trailData}
        pin={pinData}
        regionBox={regionBoxData}
        onCheckpointPress={id => {
          lastFeatureTap.current = Date.now();
          if (adv.shownId) {
            navigation.navigate('Activity', {
              screen: 'CheckpointDetails',
              params: { adventureId: adv.shownId, checkpointId: id },
            });
          }
        }}
        selectedMeetingKey={selectedMeeting}
        onMeetingPointPress={key => {
          lastFeatureTap.current = Date.now();
          setSelectedMeeting(key);
          setSelectedId(null);
          setPin(null);
          setMoving(false);
          setMovingMeeting(false);
        }}
        selectedMarkerId={selectedId}
        mapRef={mapRef}
        cameraRef={cameraRef}
        onLongPress={onLongPress}
        onMarkerPress={id => {
          lastFeatureTap.current = Date.now();
          setSelectedId(id);
          setPin(null);
          setMoving(false);
        }}
        onMapPress={onMapPress}
        onRegionChange={onRegionChange}
        onStyleLoaded={() => {
          perf.mark('map.styleLoaded');
          setMapReady(true);
        }}
        onLoadFailed={() => log.warn('map style failed to load')}
      />

      {pickReq ? (
        <PickLocationOverlay
          step={pickStep}
          top={insets.top + space.sm}
          center={view ? { lat: view.center[1], lon: view.center[0] } : null}
          includeRegion={pickReq.includeRegion}
          hint={
            meetingPick
              ? 'Move the map and place the pin at the meeting point.'
              : tripPick
              ? 'Move the map and place the pin in the middle of the trip.'
              : 'Move the map and place the pin at the checkpoint location.'
          }
          title={tripPick ? 'Trip Map' : undefined}
          confirmLabel={tripPick ? 'Use This Area' : undefined}
          meeting={!!meetingPick}
          distanceText={pickDistance}
          onUseHere={
            meetingPick && fix
              ? () =>
                  returnToEditor({ lat: fix.lat, lon: fix.lon, region: null, nonce: Date.now() })
              : undefined
          }
          region={pickRegion}
          sideKm={pickSideKm}
          sizeBytes={
            pickRegion
              ? estimateAreaBytes(pickRegion, DEFAULT_AREA_MIN_ZOOM, DEFAULT_AREA_MAX_ZOOM)
              : 0
          }
          onSideKm={setPickSideKm}
          onSearch={() => setSearchOpen(true)}
          onLocate={cycleMode}
          onPlace={placePin}
          onConfirm={confirmPick}
          onBack={pickBack}
        />
      ) : navTarget ? null : (
        <>
          <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
            <Pressable
              testID="map-search-button"
              accessibilityRole="search"
              accessibilityLabel="Search for a place"
              onPress={() => setSearchOpen(true)}
              style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <Icon name="search" size={20} color={c.textMuted} />
              <Text muted numberOfLines={1} style={{ flex: 1 }}>
                Search places
              </Text>
            </Pressable>
            <View style={styles.statusRow} pointerEvents="box-none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${statusLabel}. ${offlineLabel}`}
                onPress={showOffline}
              >
                <StatusPill
                  dark
                  testID="map-status"
                  tone={meshSnap.lifecycle === 'running' ? 'good' : 'neutral'}
                  label={statusLabel}
                />
              </Pressable>
              <View
                style={[styles.toolPill, { backgroundColor: c.surface, borderColor: c.border }]}
              >
                <Pressable
                  testID="map-offline-indicator"
                  accessibilityRole="button"
                  accessibilityLabel={offlineLabel}
                  onPress={showOffline}
                  style={styles.tool}
                >
                  <Icon
                    name={availableOffline ? 'offline' : 'online'}
                    size={22}
                    color={availableOffline ? c.primary : c.textMuted}
                  />
                </Pressable>
                <View style={[styles.toolDivider, { backgroundColor: c.border }]} />
                <Pressable
                  testID="map-download-button"
                  accessibilityRole="button"
                  accessibilityLabel="Download offline maps"
                  onPress={openArea}
                  style={styles.tool}
                >
                  <Icon name="download" size={22} color={c.text} />
                </Pressable>
              </View>
            </View>
          </View>
        </>
      )}

      {pickReq ? null : (
        <View style={[styles.controls, { bottom: bottomClear + 28 }]} pointerEvents="box-none">
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
      )}

      {movingMeeting ? (
        <View style={styles.crosshairWrap} pointerEvents="none">
          <View style={styles.movePin}>
            <FlagPin />
          </View>
        </View>
      ) : moving ? (
        <View style={styles.crosshairWrap} pointerEvents="none">
          <View style={[styles.crossH, { backgroundColor: c.primary }]} />
          <View style={[styles.crossV, { backgroundColor: c.primary }]} />
        </View>
      ) : null}

      <View
        style={[styles.attribution, { bottom: bottomClear }]}
        pointerEvents="none"
        testID="attribution"
      >
        <Text
          variant="label"
          color={c.text}
          style={[styles.attributionText, { backgroundColor: c.surface + 'CC' }]}
        >
          {OSM_ATTRIBUTION}
        </Text>
      </View>

      {navTarget && !sheetOpen && !pickReq ? (
        <NavigationBar
          target={navTarget}
          fix={fix}
          heading={headingDeg}
          units={navPrefs.units}
          paceKmh={navPrefs.paceKmh}
          trail={
            trail.status === 'ok'
              ? { remainingM: trail.remainingM, ahead: trail.ahead }
              : trail.status === 'finding'
              ? 'finding'
              : trail.status === 'none'
              ? { none: trail.reason }
              : null
          }
          top={insets.top + space.sm}
          bottom={insets.bottom}
          onView={v => v === 'compass' && openCompass(navTarget)}
          onEnd={endSession}
        />
      ) : null}

      {pin && !moving && !movingMeeting ? (
        <PinSheet
          pin={pin}
          fix={fix}
          units={navPrefs.units}
          onNavigate={() =>
            startNavigation({ name: 'Dropped pin', lat: pin.lat, lon: pin.lon, kind: 'pin' })
          }
          onSave={() => void addMarker([pin.lon, pin.lat])}
          onClose={() => setPin(null)}
        />
      ) : null}
      {selected && !moving ? (
        <MarkerSheet
          marker={selected}
          fix={fix}
          gps={gps}
          onRename={name => void points.update(selected.id, { name })}
          onMove={() => setMoving(true)}
          onDelete={confirmDelete}
          onNavigate={() =>
            startNavigation({
              name: selected.name,
              lat: selected.lat,
              lon: selected.lon,
              kind: 'marker',
              key: selected.id,
            })
          }
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
          units={navPrefs.units}
          paceKmh={navPrefs.paceKmh}
          onNavigate={() =>
            startNavigation({
              name: selectedPoint.name,
              lat: selectedPoint.lat,
              lon: selectedPoint.lon,
              kind: 'meeting',
              key: meetingPointKey(selectedPoint),
            })
          }
          onCompass={() => {
            const t: NavTarget = {
              name: selectedPoint.name,
              lat: selectedPoint.lat,
              lon: selectedPoint.lon,
              kind: 'meeting',
              key: meetingPointKey(selectedPoint),
            };
            startNavigation(t);
            openCompass(t);
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
          if (pickReq) {
            // Choosing a spot for a phase: go to the place, then the organizer places the pin.
            cameraRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 15, duration: 800 });
            return;
          }
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
          navigation.navigate('Profile', { screen: 'Download' });
        }}
        onStarted={() => {
          setAreaOpen(false);
          setAreaBbox(null);
          navigation.navigate('Profile', { screen: 'Downloaded' });
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: size.search,
    paddingHorizontal: space.lg,
    borderRadius: radius.button,
    borderWidth: 1,
  },
  statusRow: {
    position: 'absolute',
    top: size.search + space.sm,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  toolPill: { borderRadius: radius.button, borderWidth: 1, overflow: 'hidden' },
  tool: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  toolDivider: { height: 1, marginHorizontal: space.sm },
  movePin: { marginBottom: 56 },
  controls: { position: 'absolute', right: space.md, gap: space.sm },
  attribution: { position: 'absolute', right: space.sm },
  attributionText: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
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
    borderWidth: 1,
  },
});
