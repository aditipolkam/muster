import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, SegmentedTabs, Text } from './components';
import { floating, radius, space, tabular, useTheme } from './theme';

/**
 * Pieces of the trail redesign shared by the map and compass views (features never import each
 * other, so the shared presentational parts live here).
 */

/** Three (or so) equal columns: a value over a small caption, divided by hairlines. */
export function MetricStrip({
  items,
  testID,
}: {
  items: { label: string; value: string; tone?: 'good' | 'warn'; testID?: string }[];
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.strip, { borderColor: c.border }]} testID={testID}>
      {items.map((it, i) => (
        <View
          key={it.label}
          style={[
            styles.metric,
            i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border },
          ]}
        >
          <Text variant="label" muted numberOfLines={1}>
            {it.label}
          </Text>
          <Text
            variant="cardTitle"
            numberOfLines={1}
            testID={it.testID}
            color={it.tone === 'warn' ? c.warningText : it.tone === 'good' ? c.primary : c.text}
            style={tabular}
          >
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The meeting point marker: an orange teardrop with a white flag, and the name in a white chip
 * underneath. Orange is reserved for meeting points; blue is only ever "you".
 */
export function FlagPin({
  label,
  selected,
  size = 40,
}: {
  label?: string;
  selected?: boolean;
  size?: number;
}) {
  const { c } = useTheme();
  const s = selected ? size + 6 : size;
  return (
    <View style={styles.pinWrap} pointerEvents="box-none">
      <View
        style={[
          styles.drop,
          floating(c),
          {
            width: s,
            height: s,
            borderRadius: s / 2,
            borderBottomRightRadius: 3,
            backgroundColor: c.meeting,
            borderColor: c.onInk,
          },
        ]}
      >
        <View style={styles.dropInner}>
          <Icon name="flag" filled size={Math.round(s * 0.45)} color={c.onInk} />
        </View>
      </View>
      {label ? (
        <View
          style={[
            styles.pinLabel,
            floating(c),
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <Text variant="label" numberOfLines={1} style={{ fontWeight: '800' }}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A dark hint chip over the map, e.g. "Drag the map to move the pin". */
export function HintChip({ text, testID }: { text: string; testID?: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.hint, { backgroundColor: c.ink }]} testID={testID}>
      <Text variant="label" color={c.onInk}>
        {text}
      </Text>
    </View>
  );
}

/** Square tile with an arrow turned to a relative direction (0 = straight ahead). */
export function DirectionTile({ deg, dark }: { deg: number | null; dark?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      style={[styles.dirTile, { backgroundColor: dark ? c.meeting : c.meetingSoft }]}
      accessibilityElementsHidden
    >
      <View style={{ transform: [{ rotate: `${deg ?? 0}deg` }] }}>
        <Icon name="arrowUp" size={30} color={dark ? c.onInk : c.meetingStroke} />
      </View>
    </View>
  );
}

export type NavView = 'map' | 'compass';

/** Bottom of the navigating views: where to, Map | Compass, and End navigation. */
export function NavControls({
  name,
  subtitle,
  view,
  onView,
  onEnd,
  onChange,
}: {
  name: string;
  subtitle?: string;
  view: NavView;
  onView: (v: NavView) => void;
  onEnd: () => void;
  /** Change the destination (compass view only). */
  onChange?: () => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.destRow}>
        <View style={[styles.destTile, { backgroundColor: c.meetingSoft }]}>
          <Icon name="flag" size={20} color={c.meetingStroke} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="cardTitle" numberOfLines={1}>
            {name}
          </Text>
          {subtitle ? (
            <Text variant="caption" muted numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onChange ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change destination"
            onPress={onChange}
            hitSlop={10}
            style={styles.link}
          >
            <Text variant="caption" color={c.primary} style={{ fontWeight: '800' }}>
              Change
            </Text>
          </Pressable>
        ) : null}
      </View>
      <SegmentedTabs<NavView>
        options={[
          { value: 'map', label: 'Map' },
          { value: 'compass', label: 'Compass' },
        ]}
        value={view}
        onChange={onView}
        testID="nav-view"
      />
      <Button variant="danger" label="End navigation" onPress={onEnd} testID="navigation-end" />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  metric: { flex: 1, paddingHorizontal: space.md, gap: 2 },
  pinWrap: { alignItems: 'center' },
  drop: {
    transform: [{ rotate: '45deg' }],
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropInner: { transform: [{ rotate: '-45deg' }] },
  pinLabel: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 180,
  },
  hint: {
    alignSelf: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  dirTile: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  destTile: {
    width: 40,
    height: 40,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { minHeight: 44, justifyContent: 'center' },
});
