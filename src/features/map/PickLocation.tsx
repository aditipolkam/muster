import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { boxSideKm, MAX_REGION_SIDE_KM, MIN_REGION_SIDE_KM } from '../../domain/adventures/area';
import { formatBytesShort } from '../../domain/adventures/phases';
import { formatCoord } from '../../domain/geo';
import { Button, Icon, IconButton, Text } from '../../ui/components';
import { floating, radius, size, space, useTheme } from '../../ui/theme';
import { FlagPin, HintChip } from '../../ui/trail';

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
  title = 'Select Location',
  confirmLabel = 'Confirm Location',
  meeting,
  distanceText,
  onUseHere,
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
  title?: string;
  confirmLabel?: string;
  /** Step 1 of setting a meeting point: orange pin, plain-language copy, "Use where I'm standing". */
  meeting?: boolean;
  /** "2.03 km NNW of you", when there is a fix. */
  distanceText?: string | null;
  onUseHere?: () => void;
}) {
  const { c } = useTheme();
  const side = region ? boxSideKm(region) : null;
  return (
    <>
      <View style={[styles.top, { top }]} pointerEvents="box-none">
        <View
          style={[
            styles.header,
            floating(c),
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <Pressable
            testID="pick-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            hitSlop={8}
            style={styles.back}
          >
            <Icon name="back" size={26} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text variant="cardTitle" accessibilityRole="header">
              {meeting ? 'Set meeting point' : title}
            </Text>
            {meeting ? (
              <Text variant="caption" muted>
                Step 1 of 2 · Choose the spot
              </Text>
            ) : null}
          </View>
        </View>
        {step === 'pin' ? (
          <Pressable
            testID="pick-search"
            accessibilityRole="search"
            accessibilityLabel="Search for a place"
            onPress={onSearch}
            style={[
              styles.search,
              floating(c),
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Icon name="search" size={20} color={c.textMuted} />
            <Text muted style={{ flex: 1 }} numberOfLines={1}>
              {meeting ? 'Search a place or paste coordinates' : 'Search for a place'}
            </Text>
          </Pressable>
        ) : null}
        {step === 'pin' && !meeting ? (
          <View
            style={[styles.hint, { backgroundColor: c.surface, borderColor: c.border }]}
            testID="pick-hint"
          >
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

      {step === 'pin' && meeting ? (
        // A fixed orange pin whose tip sits on the map centre; the map moves under it.
        <View style={styles.crosshairWrap} pointerEvents="none" testID="pick-crosshair">
          <View style={styles.meetingPin}>
            <View testID="pick-hint">
              <HintChip text="Drag the map to move the pin" />
            </View>
            <View style={{ height: space.sm }} />
            <FlagPin />
          </View>
        </View>
      ) : step === 'pin' ? (
        <View style={styles.crosshairWrap} pointerEvents="none" testID="pick-crosshair">
          <View style={[styles.ring, { borderColor: c.primary }]} />
          <View style={[styles.crossH, { backgroundColor: c.primary }]} />
          <View style={[styles.crossV, { backgroundColor: c.primary }]} />
        </View>
      ) : null}

      <View
        style={[styles.card, floating(c), { backgroundColor: c.surface, borderColor: c.border }]}
      >
        <View style={[styles.grabber, { backgroundColor: c.border }]} />
        {step === 'pin' && meeting ? (
          <>
            <View style={{ gap: 2 }}>
              <Text variant="cardTitle" testID="pick-coords">
                {center ? formatCoord(center) : 'Move the map'}
              </Text>
              <Text variant="caption" muted testID="pick-distance">
                {distanceText ?? 'Distance from you shows once GPS has a fix'}
              </Text>
            </View>
            <Button
              testID="pick-place-pin"
              label="Use this spot →"
              onPress={onPlace}
              disabled={!center}
            />
            {onUseHere ? (
              <Button
                testID="pick-use-here"
                variant="ghost"
                icon="locate"
                label="Use where I'm standing"
                onPress={onUseHere}
              />
            ) : null}
          </>
        ) : step === 'pin' ? (
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
            <Button testID="pick-confirm" icon="check" label={confirmLabel} onPress={onConfirm} />
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
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  back: { width: size.touch, height: size.touch, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: size.search,
    paddingHorizontal: space.lg,
    borderRadius: radius.button,
    borderWidth: 1,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  // The pin's tip (bottom of the column) sits on the centre: lift the column by its height.
  meetingPin: { alignItems: 'center', marginBottom: 92 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: -space.sm },
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
    borderWidth: 1,
  },
  regionHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
});
