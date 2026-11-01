import {
  Camera,
  CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  MapRef,
  ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import React from 'react';
import { NativeSyntheticEvent, StyleSheet } from 'react-native';
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
  selectedMarkerId: string | null;
  mapRef: React.Ref<MapRef>;
  cameraRef: React.Ref<CameraRef>;
  onLongPress: (lngLat: [number, number]) => void;
  onMarkerPress: (id: string) => void;
  onMapPress: () => void;
  onRegionChange: (e: ViewStateChangeEvent) => void;
  onStyleLoaded: () => void;
  onLoadFailed: () => void;
};

const PRIMARY = '#2D6A4F';
const MEETING = '#1D5FD6';

/** All MapLibre-specific rendering. Kept separate so MapScreen can be tested with a mocked module. */
export function MapCanvas(p: Props) {
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
      onPress={() => p.onMapPress()}
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

      <GeoJSONSource id="me-accuracy" data={p.me.accuracy}>
        <Layer
          id="me-accuracy-fill"
          type="fill"
          paint={{ 'fill-color': PRIMARY, 'fill-opacity': 0.14 }}
        />
        <Layer
          id="me-accuracy-line"
          type="line"
          paint={{ 'line-color': PRIMARY, 'line-opacity': 0.5, 'line-width': 1 }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="me-cone" data={p.me.cone}>
        <Layer
          id="me-cone-fill"
          type="fill"
          paint={{ 'fill-color': PRIMARY, 'fill-opacity': 0.35 }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="me-puck" data={p.me.puck}>
        <Layer
          id="me-puck-halo"
          type="circle"
          paint={{
            'circle-radius': 11,
            'circle-color': '#FFFFFF',
            'circle-pitch-alignment': 'map',
          }}
        />
        <Layer
          id="me-puck-dot"
          type="circle"
          paint={{
            'circle-radius': 7,
            'circle-color': ['case', ['get', 'stale'], '#8A8F8C', '#2F80ED'],
          }}
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
        <Layer
          id="meeting-ring"
          type="circle"
          filter={['==', ['get', 'id'], p.selectedMeetingKey ?? '']}
          paint={{ 'circle-radius': 21, 'circle-color': MEETING, 'circle-opacity': 0.35 }}
        />
        <Layer
          id="meeting-dot"
          type="circle"
          paint={{
            'circle-radius': 12,
            'circle-color': MEETING,
            'circle-stroke-color': ['case', ['get', 'acked'], '#2D6A4F', '#FFFFFF'],
            'circle-stroke-width': 3,
          }}
        />
        <Layer
          id="meeting-label"
          type="symbol"
          layout={{
            'text-field': ['get', 'name'],
            'text-font': [OVERLAY_FONT],
            'text-size': 14,
            'text-offset': [0, 1.7],
            'text-anchor': 'top',
            'text-allow-overlap': false,
            'text-optional': true,
          }}
          paint={{ 'text-color': '#0B2A66', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.8 }}
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
          paint={{ 'circle-radius': 17, 'circle-color': '#D98E04', 'circle-opacity': 0.35 }}
        />
        <Layer
          id="markers-dot"
          type="circle"
          paint={{
            'circle-radius': 9,
            'circle-color': '#D98E04',
            'circle-stroke-color': '#FFFFFF',
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
          paint={{ 'text-color': '#16201A', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 }}
        />
      </GeoJSONSource>
    </Map>
  );
}
