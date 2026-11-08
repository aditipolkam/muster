import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, useTheme } from './theme';

type TextVariant =
  | 'hero'
  | 'title'
  | 'heading'
  | 'cardTitle'
  | 'body'
  | 'caption'
  | 'mono'
  | 'label'
  | 'metric';

const textStyles: Record<TextVariant, TextStyle> = {
  hero: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  mono: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  metric: { fontSize: 34, lineHeight: 40, fontWeight: '700', fontVariant: ['tabular-nums'] },
};

/**
 * One icon family (Ionicons, via @expo/vector-icons, which ships with expo and loads its font
 * through the already-linked expo-font). Names are app concepts; this is the only place that
 * knows the family, so swapping it later (the design system names Lucide) touches one table.
 * Each entry is the outline name; `filled` drops the `-outline` suffix for the solid variant.
 */
const GLYPHS = {
  map: 'map-outline',
  group: 'people-outline',
  navigate: 'navigate-outline',
  compass: 'compass-outline',
  offline: 'checkmark-circle-outline',
  online: 'cloud-outline',
  profile: 'person-outline',
  more: 'ellipsis-horizontal',
  menu: 'ellipsis-vertical',
  qr: 'qr-code-outline',
  exit: 'exit-outline',
  sync: 'sync-outline',
  stop: 'stop-circle-outline',
  radio: 'radio-outline',
  back: 'chevron-back',
  chevron: 'chevron-forward',
  layers: 'layers-outline',
  locate: 'locate-outline',
  follow: 'navigate',
  plus: 'add',
  check: 'checkmark',
  close: 'close',
  flag: 'flag-outline',
  mesh: 'git-network-outline',
  settings: 'settings-outline',
  pin: 'location-outline',
  trail: 'trail-sign-outline',
  trophy: 'trophy-outline',
  walk: 'walk-outline',
  help: 'help-circle-outline',
  share: 'share-outline',
  bearing: 'compass-outline',
  download: 'download-outline',
  search: 'search-outline',
  bluetooth: 'bluetooth',
  grip: 'reorder-two-outline',
  up: 'chevron-up',
  down: 'chevron-down',
  flower: 'flower-outline',
  camera: 'camera-outline',
  image: 'image-outline',
  list: 'list-outline',
  send: 'send-outline',
  time: 'time-outline',
  info: 'information-circle-outline',
  lock: 'lock-closed-outline',
  circle: 'ellipse-outline',
  done: 'checkmark-circle',
  region: 'scan-outline',
  rules: 'document-text-outline',
  ribbon: 'ribbon-outline',
} as const;
export type IconName = keyof typeof GLYPHS;

export function Icon({
  name,
  size = 20,
  color,
  filled,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Solid variant, used for the selected tab. */
  filled?: boolean;
}) {
  const { c } = useTheme();
  const glyph = GLYPHS[name];
  return (
    <Ionicons
      accessibilityElementsHidden
      importantForAccessibility="no"
      name={(filled ? glyph.replace('-outline', '') : glyph) as never}
      size={size}
      color={color ?? c.text}
    />
  );
}

export function Text({
  variant = 'body',
  muted,
  color,
  style,
  ...rest
}: React.ComponentProps<typeof RNText> & {
  variant?: TextVariant;
  muted?: boolean;
  color?: string;
}) {
  const { c } = useTheme();
  return (
    <RNText
      {...rest}
      style={[textStyles[variant], { color: color ?? (muted ? c.textMuted : c.text) }, style]}
    />
  );
}

export function ScreenHeader({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
        >
          <Icon name="back" size={30} />
        </Pressable>
      ) : null}
      <Text variant="title" style={{ flex: 1 }} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Detail screens pass `onBack`; main tabs omit it. */
export function Screen({
  title,
  right,
  onBack,
  children,
  scroll: _scroll,
  edges = ['top'],
}: {
  title?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  children: React.ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={edges}>
      {title ? <ScreenHeader title={title} right={right} onBack={onBack} /> : null}
      {children}
    </SafeAreaView>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  small,
  icon,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { c } = useTheme();
  const bg =
    variant === 'primary'
      ? c.primary
      : variant === 'danger'
      ? c.danger
      : variant === 'secondary'
      ? c.primarySoft
      : 'transparent';
  const fg =
    variant === 'primary'
      ? c.onPrimary
      : variant === 'danger'
      ? c.onDanger
      : variant === 'secondary'
      ? c.deep
      : c.primary;
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityLabel={label}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        {
          backgroundColor: pressed && variant === 'primary' ? c.primaryPressed : bg,
          opacity: off ? 0.45 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          <Text variant="body" color={fg} style={{ fontWeight: '600', lineHeight: 20 }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  style,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}
    >
      {children}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const { c } = useTheme();
  const bg =
    tone === 'good'
      ? c.infoBg
      : tone === 'warn'
      ? c.warningBg
      : tone === 'bad'
      ? c.dangerBg
      : c.surfaceAlt;
  const fg =
    tone === 'good'
      ? c.primary
      : tone === 'warn'
      ? c.warning
      : tone === 'bad'
      ? c.danger
      : c.textMuted;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant="caption" color={fg} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
  style,
  testID,
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { c } = useTheme();
  const dot =
    tone === 'good'
      ? c.connected
      : tone === 'warn'
      ? c.warning
      : tone === 'bad'
      ? c.danger
      : c.textMuted;
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: c.surface, borderColor: c.border }, style]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text variant="caption" style={{ fontWeight: '500' }}>
        {label}
      </Text>
    </View>
  );
}

/** Soft-green rounded square for feature rows and special actions only. */
export function IconTile({ name, color, bg }: { name: IconName; color?: string; bg?: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: bg ?? c.primarySoft }]}>
      <Icon name={name} size={20} color={color ?? c.primary} />
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  chevron,
  divider = true,
  testID,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  divider?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  const body = (
    <>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        <Text variant="cardTitle">{title}</Text>
        {subtitle ? (
          <Text variant="caption" muted>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={{ alignSelf: 'center' }}>{trailing}</View> : null}
      {chevron ? <Icon name="chevron" size={22} color={c.textMuted} /> : null}
    </>
  );
  const rowStyle = [
    styles.listRow,
    divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  ];
  return onPress ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View testID={testID} style={rowStyle}>
      {body}
    </View>
  );
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  fill,
  testID,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Share the row equally between the tabs, so several fit at phone width. */
  fill?: boolean;
  /** Each tab gets `${testID}-${value}`. */
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', gap: fill ? space.xs : space.sm }}
      accessibilityRole="tablist"
      testID={testID}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            testID={testID ? `${testID}-${o.value}` : undefined}
            style={[
              styles.segment,
              fill && styles.segmentFill,
              { backgroundColor: on ? c.primary : c.surfaceAlt, borderColor: c.border },
            ]}
          >
            <Text
              variant="caption"
              color={on ? c.onPrimary : c.text}
              style={{ fontWeight: '600' }}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  const { c } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={[styles.track, { backgroundColor: c.surfaceAlt }]}
    >
      <View
        style={{
          width: indeterminate ? '35%' : `${pct * 100}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: c.primary,
        }}
      />
    </View>
  );
}

export function Banner({
  tone = 'info',
  title,
  body,
  actionLabel,
  onAction,
  onDismiss,
  style,
}: {
  tone?: 'info' | 'warn' | 'error';
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const bg = tone === 'error' ? c.dangerBg : tone === 'warn' ? c.warningBg : c.infoBg;
  const fg = tone === 'error' ? c.danger : tone === 'warn' ? c.warning : c.primary;
  return (
    <View
      style={[styles.banner, { backgroundColor: bg, borderColor: fg }, style]}
      accessibilityRole="alert"
    >
      <View style={{ flex: 1 }}>
        <Text variant="body" color={fg} style={{ fontWeight: '700' }}>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" color={c.text} style={{ marginTop: 2 }}>
            {body}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Button small variant="secondary" label={actionLabel} onPress={onAction} />
      ) : null}
      {onDismiss ? <Button small variant="ghost" label="Hide" onPress={onDismiss} /> : null}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text muted style={{ textAlign: 'center' }}>
        {body}
      </Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function Row({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>
      {children}
    </View>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

export function IconButton({
  glyph,
  icon,
  label,
  onPress,
  active,
  testID,
}: {
  glyph?: string;
  icon?: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: active ? c.primary : c.surface,
          borderColor: c.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? (
        <Icon name={icon} size={22} color={active ? c.onPrimary : c.text} />
      ) : (
        <Text variant="heading" color={active ? c.onPrimary : c.text}>
          {glyph}
        </Text>
      )}
    </Pressable>
  );
}

export type MenuItem = {
  label: string;
  icon?: IconName;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
};

/**
 * A small pop-up list under a header's top-right button (the overflow menu). Tapping outside,
 * or picking an item, closes it; the item runs after the menu is gone.
 */
export function Menu({
  visible,
  onClose,
  items,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  items: MenuItem[];
  testID?: string;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu">
        <View
          testID={testID}
          accessibilityRole="menu"
          style={[
            styles.menu,
            { top: insets.top + 56, backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          {items.map((it, i) => {
            const fg = it.destructive ? c.danger : c.text;
            return (
              <Pressable
                key={it.label}
                testID={it.testID}
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: !!it.disabled }}
                onPress={
                  it.disabled
                    ? undefined
                    : () => {
                        onClose();
                        it.onPress();
                      }
                }
                style={({ pressed }) => [
                  styles.menuItem,
                  i > 0 && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth },
                  { backgroundColor: pressed ? c.surfaceAlt : 'transparent' },
                  it.disabled && { opacity: 0.45 },
                ]}
              >
                {it.icon ? <Icon name={it.icon} size={18} color={fg} /> : null}
                <Text variant="body" color={fg}>
                  {it.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    paddingBottom: space.md,
    minHeight: 56,
    gap: space.sm,
  },
  back: {
    width: 44,
    height: 44,
    marginLeft: -space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 52,
    paddingHorizontal: space.gutter,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonSmall: { minHeight: 44, paddingHorizontal: space.lg },
  card: { borderRadius: radius.card, borderWidth: 1, padding: space.lg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLeading: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingVertical: space.sm,
  },
  segment: {
    paddingHorizontal: space.lg,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  menu: {
    position: 'absolute',
    right: space.gutter,
    minWidth: 200,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: 44,
  },
  segmentFill: { flex: 1, paddingHorizontal: space.xs, alignItems: 'center' },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.md,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
