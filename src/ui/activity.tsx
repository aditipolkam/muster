import React, { useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Icon, IconName, Text } from './components';
import { radius, space, useTheme } from './theme';

/** A settings row with a title, a line of help and a switch on the right. */
export function ToggleRow({
  icon,
  title,
  body,
  value,
  onChange,
  disabled,
  testID,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.toggleRow}>
      {icon ? <Icon name={icon} size={22} color={c.primary} /> : null}
      <View style={{ flex: 1 }}>
        <Text variant="cardTitle">{title}</Text>
        {body ? (
          <Text variant="caption" muted>
            {body}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ true: c.primary, false: c.border }}
      />
    </View>
  );
}

/**
 * A horizontal slider over whole steps. Drag, tap the track, or use the accessibility actions.
 * Built here because React Native has no slider and a native one is not worth a dependency.
 */
export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  label,
  testID,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  label: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const snap = (v: number) =>
    Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const at = (x: number) =>
    widthRef.current > 0 ? snap(min + (x / widthRef.current) * (max - min)) : value;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) =>
        onChangeRef.current(at(e.nativeEvent.locationX)),
      onPanResponderMove: (e: GestureResponderEvent) =>
        onChangeRef.current(at(e.nativeEvent.locationX)),
    }),
  ).current;
  const pct = max === min ? 0 : (value - min) / (max - min);
  const act = (e: AccessibilityActionEvent) =>
    onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step)));
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={act}
      style={styles.sliderWrap}
      onLayout={(e: LayoutChangeEvent) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      {...pan.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: c.border }]} />
      <View style={[styles.fill, { backgroundColor: c.primary, width: pct * width }]} />
      <View
        style={[
          styles.thumb,
          { backgroundColor: c.surface, borderColor: c.primary, left: pct * width - 11 },
        ]}
      />
    </View>
  );
}

/** The illustrated stand-in for an activity's cover photo. */
export function CoverArt({ size = 64, round = radius.card }: { size?: number; round?: number }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      style={[
        styles.cover,
        { width: size, height: size, borderRadius: round, backgroundColor: c.primarySoft },
      ]}
    >
      <Icon name="trail" size={Math.round(size * 0.5)} color={c.primary} />
    </View>
  );
}

/** One line of "icon  label        value" used by summary cards. */
export function FactRow({
  icon,
  label,
  value,
  testID,
}: {
  icon: IconName;
  label: string;
  value: string;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.fact} testID={testID}>
      <Icon name={icon} size={22} color={c.primary} />
      <View style={{ flex: 1 }}>
        <Text variant="cardTitle">{label}</Text>
        <Text variant="caption" muted>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  sliderWrap: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2 },
  fill: { position: 'absolute', height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  cover: { alignItems: 'center', justifyContent: 'center' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
});
