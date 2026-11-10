import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GLYPHS, IconName } from './glyphs';
import {
  fontFamily,
  iconSize,
  iconWeight,
  radius,
  size as sizes,
  space,
  tabular,
  type,
  useTheme,
} from './theme';

export type { IconName };

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

/** Text variants read the type scale in theme.tsx. */
const textStyles: Record<TextVariant, TextStyle> = {
  hero: type.hero,
  title: type.title,
  heading: type.heading,
  cardTitle: type.cardTitle,
  body: type.body,
  caption: type.caption,
  label: type.label,
  mono: { fontSize: 13, lineHeight: 18, ...tabular },
  metric: { fontSize: 34, lineHeight: 40, fontWeight: '800', ...tabular },
};

/**
 * SF Symbols only when the native module is in the installed build. A build made before
 * expo-symbols was added renders SymbolView as an "Unimplemented component" box, so it falls
 * back to Ionicons (bundled with the app) until the next native rebuild.
 */
const hasSymbols =
  Platform.OS === 'ios' &&
  !!(globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules?.SymbolModule;

/**
 * Apple-style icons: SF Symbols on iOS (thin, regular weight, sized like the text around them),
 * the matching Ionicons outline elsewhere. No icon ever sits in a coloured box.
 */
export function Icon({
  name,
  size = iconSize.md,
  color,
  filled,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Solid variant, used for the selected tab and the meeting flag. */
  filled?: boolean;
}) {
  const { c } = useTheme();
  const g: { sf: string; sfFilled?: string; ion: string; ionFilled?: string } = GLYPHS[name];
  const tint = color ?? c.text;
  const ion = (
    <Ionicons
      accessibilityElementsHidden
      importantForAccessibility="no"
      name={((filled && g.ionFilled) || g.ion) as never}
      size={size}
      color={tint}
    />
  );
  if (!hasSymbols) {
    return ion;
  }
  return (
    <SymbolView
      name={((filled && g.sfFilled) || g.sf) as never}
      size={size}
      tintColor={tint}
      weight={iconWeight}
      type="monochrome"
      fallback={ion}
      accessibilityElementsHidden
      importantForAccessibility="no"
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
      style={[
        textStyles[variant],
        fontFamily ? { fontFamily } : null,
        { color: color ?? (muted ? c.textMuted : c.text) },
        style,
      ]}
    />
  );
}

/**
 * Root tabs: a large title on the left, actions on the right. Detail screens (with `onBack`): a
 * centred title between two equal 44pt slots, so the title sits in the middle of the screen.
 */
export function ScreenHeader({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  if (!onBack) {
    return (
      <View style={styles.header}>
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
        >
          <Icon name="back" size={iconSize.lg} />
        </Pressable>
      </View>
      <Text
        variant="heading"
        style={styles.headerTitle}
        accessibilityRole="header"
        numberOfLines={1}
      >
        {title}
      </Text>
      <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

/** A full-pill text field (multi-line notes get the large container radius). */
export const Input = React.forwardRef<TextInput, TextInputProps>(function Input(
  { style, multiline, ...rest },
  ref,
) {
  const { c } = useTheme();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={c.textMuted}
      multiline={multiline}
      {...rest}
      style={[
        styles.input,
        multiline && styles.inputMulti,
        { color: c.text, borderColor: c.border, backgroundColor: c.surface },
        style,
      ]}
    />
  );
});

/** A pill search field: leading magnifier, and a clear button once there is text. */
export const SearchField = React.forwardRef<
  TextInput,
  TextInputProps & { onClear?: () => void; containerStyle?: StyleProp<ViewStyle> }
>(function SearchField({ style, containerStyle, value, onClear, onChangeText, ...rest }, ref) {
  const { c } = useTheme();
  const clear = onClear ?? (onChangeText ? () => onChangeText('') : undefined);
  return (
    <View
      style={[
        styles.search,
        { borderColor: c.border, backgroundColor: c.surface },
        containerStyle,
      ]}
    >
      <Icon name="search" size={iconSize.md} color={c.textMuted} />
      <TextInput
        ref={ref}
        placeholderTextColor={c.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        value={value}
        onChangeText={onChangeText}
        {...rest}
        style={[styles.searchInput, { color: c.text }, style]}
      />
      {value && clear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={clear}
          hitSlop={8}
          style={styles.searchClear}
        >
          <Icon name="close" size={iconSize.sm} color={c.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

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
  /**
   * primary: the one main action. secondary: soft green. danger: soft red, destructive only.
   * meeting: soft orange, meeting-point actions only. light: white on a dark card. ghost: text.
   */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'meeting' | 'light';
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
      ? c.dangerBg
      : variant === 'secondary'
      ? c.primarySoft
      : variant === 'meeting'
      ? c.meetingSoft
      : variant === 'light'
      ? c.surface
      : 'transparent';
  const fg =
    variant === 'primary'
      ? c.onPrimary
      : variant === 'danger'
      ? c.danger
      : variant === 'secondary'
      ? c.deep
      : variant === 'meeting'
      ? c.meetingText
      : variant === 'light'
      ? c.text
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
          {icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} /> : null}
          <Text
            variant="body"
            color={fg}
            numberOfLines={1}
            style={small ? styles.buttonLabelSmall : styles.buttonLabel}
          >
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

export type ChipTone = 'neutral' | 'good' | 'warn' | 'bad' | 'meeting';

/** A small rounded chip. `dot` puts a presence dot before the label; `icon` a small glyph. */
export function Badge({
  label,
  tone = 'neutral',
  icon,
  dot,
  testID,
}: {
  label: string;
  tone?: ChipTone;
  icon?: IconName;
  dot?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  const bg =
    tone === 'good'
      ? c.primarySoft
      : tone === 'warn'
      ? c.warningBg
      : tone === 'bad'
      ? c.dangerBg
      : tone === 'meeting'
      ? c.meetingSoft
      : c.surfaceAlt;
  const fg =
    tone === 'good'
      ? c.deep
      : tone === 'warn'
      ? c.warningText
      : tone === 'bad'
      ? c.danger
      : tone === 'meeting'
      ? c.meetingText
      : c.textMuted;
  const glyph = tone === 'meeting' ? c.meetingStroke : tone === 'good' ? c.primary : fg;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} testID={testID}>
      {dot ? (
        <View
          style={[styles.dot, { backgroundColor: tone === 'good' ? c.connected : c.textMuted }]}
        />
      ) : null}
      {icon ? <Icon name={icon} size={14} color={glyph} /> : null}
      <Text variant="label" color={fg} numberOfLines={1} style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A selectable pill (filters, kinds, quick picks). Without `onPress` it is a static badge.
 * 36pt tall with hit slop, so the touch target is 44.
 */
export function Chip({
  label,
  selected,
  onPress,
  icon,
  tone,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: ChipTone;
  testID?: string;
}) {
  const { c } = useTheme();
  if (!onPress) {
    return <Badge label={label} icon={icon} tone={tone} testID={testID} />;
  }
  const fg = selected ? c.onPrimary : c.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.primary : c.surface,
          borderColor: selected ? c.primary : c.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={iconSize.sm} color={fg} /> : null}
      <Text variant="caption" color={fg} numberOfLines={1} style={styles.badgeText}>
        {label}
      </Text>
    </Pressable>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
  style,
  testID,
  dark,
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Dark ink pill, for status floating over the map. */
  dark?: boolean;
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
      style={[
        styles.pill,
        dark
          ? { backgroundColor: c.ink, borderColor: c.ink }
          : { backgroundColor: c.surface, borderColor: c.border },
        style,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text variant="caption" color={dark ? c.onInk : c.text} style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A leading icon for rows and headers. No box behind it: the icon alone, in the primary colour
 * (or the meeting orange for meeting points), centred in a fixed slot so rows line up.
 */
export function IconTile({
  name,
  color,
  size: s = 28,
  tone,
}: {
  name: IconName;
  color?: string;
  /** Kept for older callers; there is no background any more. */
  bg?: string;
  size?: number;
  /** meeting: the orange flag. */
  tone?: 'primary' | 'meeting';
}) {
  const { c } = useTheme();
  const fg = color ?? (tone === 'meeting' ? c.meetingStroke : c.primary);
  return (
    <View style={[styles.tile, { width: Math.max(28, s), height: Math.max(28, s) }]}>
      <Icon
        name={name}
        size={Math.round(Math.min(26, s * 0.75))}
        color={fg}
        filled={tone === 'meeting'}
      />
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
      style={[styles.segTrack, { backgroundColor: c.surfaceAlt }]}
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
              (fill ?? true) && styles.segmentFill,
              on
                ? [{ backgroundColor: c.surface, borderColor: c.border }, styles.segmentOn]
                : { backgroundColor: 'transparent', borderColor: 'transparent' },
            ]}
          >
            <Text
              variant="caption"
              color={on ? c.text : c.textMuted}
              style={{ fontWeight: on ? '800' : '600' }}
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
  const bg = tone === 'error' ? c.dangerBg : tone === 'warn' ? c.warningBg : c.primarySoft;
  const fg = tone === 'error' ? c.danger : tone === 'warn' ? c.warning : c.deep;
  const edge = tone === 'error' ? c.dangerBg : tone === 'warn' ? c.warningBorder : c.primarySoft;
  const glyph: IconName = tone === 'info' ? 'info' : 'warning';
  return (
    <View
      style={[styles.banner, { backgroundColor: bg, borderColor: edge }, style]}
      accessibilityRole="alert"
    >
      <Icon name={glyph} size={20} color={fg} />
      <View style={{ flex: 1 }}>
        <Text variant="body" color={fg} style={{ fontWeight: '700' }}>
          {title}
        </Text>
        {body ? (
          <Text
            variant="caption"
            color={tone === 'warn' ? c.warningText : c.textMuted}
            style={{ marginTop: 2, fontWeight: '500' }}
          >
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
          borderColor: active ? c.primary : c.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? (
        <Icon name={icon} size={iconSize.lg} color={active ? c.onPrimary : c.text} />
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
    paddingTop: space.sm,
    paddingBottom: space.md,
    minHeight: 60,
    gap: space.sm,
  },
  headerSide: { width: sizes.touch, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  back: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: sizes.input,
    paddingHorizontal: space.gutter,
    borderRadius: radius.pill,
    borderWidth: 1,
    ...type.input,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: sizes.search,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  searchInput: { flex: 1, minHeight: sizes.search, ...type.input },
  searchClear: {
    width: sizes.touch - space.sm,
    height: sizes.touch - space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: sizes.chip,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  inputMulti: {
    minHeight: 96,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderRadius: radius.card,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: sizes.button,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonSmall: {
    minHeight: sizes.buttonSmall,
    paddingHorizontal: space.lg,
  },
  buttonLabel: type.button,
  buttonLabelSmall: { ...type.button, fontSize: 15 },
  card: { borderRadius: radius.card, borderWidth: 1, padding: space.gutter },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  tile: { alignItems: 'center', justifyContent: 'center' },
  rowLeading: { width: sizes.iconSlot, alignItems: 'center', justifyContent: 'center' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.md,
  },
  segTrack: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: radius.pill },
  segment: {
    paddingHorizontal: space.lg,
    minHeight: sizes.segment,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  segmentOn: {},
  menu: {
    position: 'absolute',
    right: space.gutter,
    minWidth: 220,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingVertical: space.sm,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    minHeight: sizes.touch,
  },
  segmentFill: { flex: 1, paddingHorizontal: space.xs, alignItems: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 28,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  badgeText: { fontWeight: '700', flexShrink: 1 },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.md,
  },
  iconButton: {
    width: sizes.iconButton,
    height: sizes.iconButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
