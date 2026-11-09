import {
  Camera,
  CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  MapRef,
  Marker,
  ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import React from 'react';
import { NativeSyntheticEvent, StyleSheet } from 'react-native';
import { useTheme } from '../../ui/theme';
import { FlagPin } from '../../ui/trail';
import { OVERLAY_FONT } from './StyleBuilder';

export type MapCanvasHandle = { map: MapRef | null; camera: CameraRef | null };

type Props = {
  mapStyle: StyleSpecification;
  initial: { center: [number, number]; zoom: number } | null;
  me: { accuracy: FeatureCollection; cone: FeatureCollection; puck: FeatureCollection };
  markers: FeatureCollection;
  /** Shared group meeting points (ids are `<groupId>:<pointId>`). */
  meetingPoints: FeatureCollection;
  selectedMeetingKey: string | null;
  onMeetingPointPress: (key: string) => void;
  /** Checkpoints of the adventure being shown, and its recorded route. */
  checkpoints: FeatureCollection;
  route: FeatureCollection;
  /** One checkpoint gently swells for a moment when it is reached; `step` is 0..2. */
  pulse: { id: string; step: number } | null;
  onCheckpointPress: (id: string) => void;
  selectedMarkerId: string | null;
  mapRef: React.Ref<MapRef>;
  cameraRef: React.Ref<CameraRef>;
  onLongPress: (lngLat: [number, number]) => void;
  onMarkerPress: (id: string) => void;
  /** Tap on empty map. */
  onMapPress: (lngLat: [number, number]) => void;
  /** Straight guidance line to the navigation target, and the temporary pin it points at. */
  guide: FeatureCollection;
  /** Walking route along the paths (solid orange), when one was found. */
  trail?: FeatureCollection;
  pin: FeatureCollection;
  /** The offline map region being chosen for a phase, as a rectangle. */
  regionBox: FeatureCollection;
  onRegionChange: (e: ViewStateChangeEvent) => void;
  onStyleLoaded: () => void;
  onLoadFailed: () => void;
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** All MapLibre-specific rendering. Kept separate so MapScreen can be tested with a mocked module. */
export function MapCanvas(p: Props) {
  const { c } = useTheme();
  // Map colours come from the theme tokens: blue is only "you", orange only meeting points.
  const PRIMARY = c.primary;
  const MEETING = c.meeting;
  const SELF = c.self;
  const TRAIL = c.mapTrail;
  const WHITE = c.onInk;
  const INK = c.ink;
  const meetingFeatures = p.meetingPoints.features.filter(
    f => f.geometry.type === 'Point' && typeof f.properties?.id === 'string',
  );
  return (
    <Map
      ref={p.mapRef}
      style={StyleSheet.absoluteFill}
      mapStyle={p.mapStyle}
      attribution={false}
      logo={false}
      compass
      compassHiddenFacingNorth
      compassPosition={{ top: 120, right: 12 }}
      touchRotate
      touchPitch={false}
      onLongPress={e => {
        const [lon, lat] = e.nativeEvent.lngLat;
        p.onLongPress([lon, lat]);
      }}
      onPress={e => {
        const [lon, lat] = e.nativeEvent.lngLat;
        p.onMapPress([lon, lat]);
      }}
      onRegionDidChange={(e: NativeSyntheticEvent<ViewStateChangeEvent>) =>
        p.onRegionChange(e.nativeEvent)
      }
      onDidFinishLoadingStyle={() => p.onStyleLoaded()}
      onDidFailLoadingMap={() => p.onLoadFailed()}
    >
      <Camera
        ref={p.cameraRef}
        initialViewState={p.initial ?? { center: [0, 20], zoom: 1.5 }}
        minZoom={0}
        maxZoom={19}
      />

      <GeoJSONSource id="trail-route" data={p.trail ?? EMPTY}>
        <Layer
          id="trail-route-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': WHITE, 'line-width': 9, 'line-opacity': 0.9 }}
        />
        <Layer
          id="trail-route-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': MEETING, 'line-width': 5 }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="guide-line" data={p.guide}>
        <Layer
          id="guide-line-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': WHITE, 'line-width': 7, 'line-opacity': 0.85 }}
        />
        <Layer
          id="guide-line-dash"
          type="line"
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
          paint={{ 'line-color': MEETING, 'line-width': 4, 'line-dasharray': [2, 1.5] }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="region-box" data={p.regionBox}>
        <Layer
          id="region-box-fill"
          type="fill"
          paint={{ 'fill-color': PRIMARY, 'fill-opacity': 0.1 }}
        />
        <Layer
          id="region-box-line"
          type="line"
          paint={{ 'line-color': PRIMARY, 'line-width': 2, 'line-dasharray': [3, 2] }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="pin" data={p.pin}>
        <Layer
          id="pin-halo"
          type="circle"
          paint={{ 'circle-radius': 15, 'circle-color': INK, 'circle-opacity': 0.18 }}
        />
        <Layer
          id="pin-dot"
          type="circle"
          paint={{
            'circle-radius': 8,
            'circle-color': INK,
            'circle-stroke-color': WHITE,
            'circle-stroke-width': 3,
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="me-accuracy" data={p.me.accuracy}>
        <Layer
          id="me-accuracy-fill"
          type="fill"
          paint={{ 'fill-color': SELF, 'fill-opacity': 0.1 }}
        />
        <Layer
          id="me-accuracy-line"
          type="line"
          paint={{ 'line-color': SELF, 'line-opacity': 0.4, 'line-width': 1 }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="me-cone" data={p.me.cone}>
        <Layer id="me-cone-fill" type="fill" paint={{ 'fill-color': SELF, 'fill-opacity': 0.25 }} />
      </GeoJSONSource>

      <GeoJSONSource id="me-puck" data={p.me.puck}>
        <Layer
          id="me-puck-glow"
          type="circle"
          paint={{
            'circle-radius': 20,
            'circle-color': SELF,
            'circle-opacity': 0.16,
            'circle-pitch-alignment': 'map',
          }}
        />
        <Layer
          id="me-puck-halo"
          type="circle"
          paint={{
            'circle-radius': 11,
            'circle-color': WHITE,
            'circle-pitch-alignment': 'map',
          }}
        />
        <Layer
          id="me-puck-dot"
          type="circle"
          paint={{
            'circle-radius': 7,
            'circle-color': ['case', ['get', 'stale'], c.textMuted, SELF],
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="adventure-route" data={p.route}>
        <Layer
          id="adventure-route-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': WHITE, 'line-width': 7, 'line-opacity': 0.8 }}
        />
        <Layer
          id="adventure-route-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': TRAIL, 'line-width': 4 }}
        />
      </GeoJSONSource>

      <GeoJSONSource
        id="checkpoints"
        data={p.checkpoints}
        hitbox={{ top: 20, bottom: 20, left: 20, right: 20 }}
        onPress={e => {
          const id = e.nativeEvent.features[0]?.properties?.id;
          if (typeof id === 'string') {
            p.onCheckpointPress(id);
          }
        }}
      >
        <Layer
          id="checkpoint-pulse"
          type="circle"
          paint={{
            'circle-radius': [
              'case',
              ['==', ['get', 'id'], p.pulse?.id ?? ''],
              14 + (p.pulse?.step ?? 0) * 7,
              0,
            ],
            'circle-color': PRIMARY,
            'circle-opacity': 0.32 - (p.pulse?.step ?? 0) * 0.1,
          }}
        />
        <Layer
          id="checkpoint-dot"
          type="circle"
          paint={{
            'circle-radius': 10,
            'circle-color': ['case', ['get', 'reached'], PRIMARY, WHITE],
            'circle-stroke-color': PRIMARY,
            'circle-stroke-width': 3,
          }}
        />
        <Layer
          id="checkpoint-label"
          type="symbol"
          layout={{
            'text-field': ['get', 'name'],
            'text-font': [OVERLAY_FONT],
            'text-size': 13,
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true,
          }}
          paint={{ 'text-color': c.deep, 'text-halo-color': WHITE, 'text-halo-width': 1.8 }}
        />
      </GeoJSONSource>

      <GeoJSONSource
        id="meeting-points"
        data={p.meetingPoints}
        hitbox={{ top: 20, bottom: 20, left: 20, right: 20 }}
        onPress={e => {
          const id = e.nativeEvent.features[0]?.properties?.id;
          if (typeof id === 'string') {
            p.onMeetingPointPress(id);
          }
        }}
      >
        {/* Tap target only; the visible pin is the FlagPin marker below. */}
        <Layer
          id="meeting-hit"
          type="circle"
          paint={{ 'circle-radius': 22, 'circle-color': MEETING, 'circle-opacity': 0 }}
        />
      </GeoJSONSource>

      <GeoJSONSource
        id="markers"
        data={p.markers}
        hitbox={{ top: 16, bottom: 16, left: 16, right: 16 }}
        onPress={e => {
          const id = e.nativeEvent.features[0]?.properties?.id;
          if (typeof id === 'string') {
            p.onMarkerPress(id);
          }
        }}
      >
        <Layer
          id="markers-ring"
          type="circle"
          filter={['==', ['get', 'id'], p.selectedMarkerId ?? '']}
          paint={{ 'circle-radius': 17, 'circle-color': PRIMARY, 'circle-opacity': 0.25 }}
        />
        <Layer
          id="markers-dot"
          type="circle"
          paint={{
            'circle-radius': 9,
            'circle-color': PRIMARY,
            'circle-stroke-color': WHITE,
            'circle-stroke-width': 2.5,
          }}
        />
        <Layer
          id="markers-label"
          type="symbol"
          layout={{
            'text-field': ['get', 'name'],
            'text-font': [OVERLAY_FONT],
            'text-size': 13,
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true,
          }}
          paint={{ 'text-color': c.text, 'text-halo-color': WHITE, 'text-halo-width': 1.6 }}
        />
      </GeoJSONSource>

      {meetingFeatures.map(f => {
        const id = f.properties!.id as string;
        const [lon, lat] = (f.geometry as { coordinates: number[] }).coordinates as [
          number,
          number,
        ];
        return (
          <Marker
            key={id}
            id={`meeting-pin-${id}`}
            lngLat={[lon, lat]}
            anchor="top"
            offset={[0, -48]}
            onPress={() => p.onMeetingPointPress(id)}
          >
            <FlagPin
              label={String(f.properties?.name ?? '')}
              selected={p.selectedMeetingKey === id}
            />
          </Marker>
        );
      })}
    </Map>
  );
}
