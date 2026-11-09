import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { boxSideKm, MAX_REGION_SIDE_KM, MIN_REGION_SIDE_KM } from '../../domain/adventures/area';
import { formatBytesShort } from '../../domain/adventures/phases';
import { formatCoord } from '../../domain/geo';
import { Button, Icon, IconButton, Text } from '../../ui/components';
import { radius, space, useTheme } from '../../ui/theme';

export type PickStep = 'pin' | 'region';

/**
 * "Select Location" on the map: move the map under a crosshair and place the pin, then (when the
 * phase includes a map region) check the offline area round it and confirm. All state lives in
 * MapScreen; this only draws the bars and the cards.
 */
export function PickLocationOverlay({
  step,
  top,
  center,
  includeRegion,
  hint,
  region,
  sideKm,
  sizeBytes,
  onSideKm,
  onSearch,
  onLocate,
  onPlace,
  onConfirm,
  onBack,
}: {
  step: PickStep;
  top: number;
  /** What the crosshair points at. */
  center: { lat: number; lon: number } | null;
  includeRegion: boolean;
  /** What to put the pin on, shown above the crosshair. */
  hint: string;
  region: [number, number, number, number] | null;
  sideKm: number;
  sizeBytes: number;
  onSideKm: (km: number) => void;
  onSearch: () => void;
  onLocate: () => void;
  onPlace: () => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { c } = useTheme();
  const side = region ? boxSideKm(region) : null;
  return (
    <>
      <View style={[styles.top, { top }]} pointerEvents="box-none">
        <View style={[styles.header, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Pressable
            testID="pick-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            hitSlop={8}
          >
            <Icon name="back" size={26} />
          </Pressable>
          <Text
            variant="heading"
            style={{ flex: 1, textAlign: 'center' }}
            accessibilityRole="header"
          >
            Select Location
          </Text>
          <View style={{ width: 26 }} />
        </View>
        {step === 'pin' ? (
          <Pressable
            testID="pick-search"
            accessibilityRole="search"
            accessibilityLabel="Search for a place"
            onPress={onSearch}
            style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Icon name="search" size={20} color={c.textMuted} />
            <Text muted style={{ flex: 1 }}>
              Search for a place
            </Text>
          </Pressable>
        ) : null}
        {step === 'pin' ? (
          <View style={[styles.hint, { backgroundColor: c.primarySoft }]} testID="pick-hint">
            <Icon name="pin" size={18} color={c.primary} />
            <Text variant="caption" style={{ flex: 1 }}>
              {hint}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.side, { top: top + 150 }]} pointerEvents="box-none">
        <IconButton
          testID="pick-locate"
          icon="locate"
          label="Center on my location"
          onPress={onLocate}
        />
      </View>

      {step === 'pin' ? (
        <View style={styles.crosshairWrap} pointerEvents="none" testID="pick-crosshair">
          <View style={[styles.ring, { borderColor: c.primary }]} />
          <View style={[styles.crossH, { backgroundColor: c.primary }]} />
          <View style={[styles.crossV, { backgroundColor: c.primary }]} />
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        {step === 'pin' ? (
          <>
            <Text variant="cardTitle" style={{ textAlign: 'center' }} testID="pick-coords">
              {center ? formatCoord(center) : 'Move the map'}
            </Text>
            <Button
              testID="pick-place-pin"
              icon="pin"
              label="Place Pin Here"
              onPress={onPlace}
              disabled={!center}
            />
          </>
        ) : (
          <>
            <View style={styles.regionHead}>
              <Icon name="download" size={22} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="cardTitle">Map Region (Offline)</Text>
                <Text variant="caption" muted testID="pick-region-size">
                  {includeRegion && side
                    ? `About ${formatBytesShort(sizeBytes)} · ~${side.widthKm} km × ${
                        side.heightKm
                      } km`
                    : 'No map region for this phase'}
                </Text>
              </View>
            </View>
            {includeRegion ? (
              <View style={styles.stepper}>
                <IconButton
                  testID="region-smaller"
                  icon="down"
                  label="Smaller region"
                  onPress={() => onSideKm(Math.max(MIN_REGION_SIDE_KM, sideKm - 1))}
                />
                <Text variant="cardTitle" testID="region-side">
                  {sideKm} km
                </Text>
                <IconButton
                  testID="region-larger"
                  icon="up"
                  label="Larger region"
                  onPress={() => onSideKm(Math.min(MAX_REGION_SIDE_KM, sideKm + 1))}
                />
              </View>
            ) : null}
            <Button
              testID="pick-confirm"
              icon="check"
              label="Confirm Location"
              onPress={onConfirm}
            />
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: space.md, right: space.md, gap: space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 48,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.input,
  },
  side: { position: 'absolute', right: space.md, gap: space.sm },
  crosshairWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', width: 56, height: 56, borderRadius: 28, borderWidth: 2 },
  crossH: { position: 'absolute', width: 22, height: 2 },
  crossV: { position: 'absolute', width: 2, height: 22 },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.md,
    padding: space.gutter,
    paddingBottom: space.xl,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  regionHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
});
