import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, useTheme } from './theme';

type TextVariant = 'title' | 'heading' | 'body' | 'caption' | 'mono' | 'label';

const textStyles: Record<TextVariant, TextStyle> = {
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  mono: { fontSize: 14, fontVariant: ['tabular-nums'] },
};

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

export function Screen({
  title,
  right,
  children,
  scroll: _scroll,
  edges = ['top'],
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={edges}>
      {title ? (
        <View style={styles.header}>
          <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
            {title}
          </Text>
          {right}
        </View>
      ) : null}
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
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
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
      ? c.surfaceAlt
      : 'transparent';
  const fg =
    variant === 'primary'
      ? c.onPrimary
      : variant === 'danger'
      ? c.onDanger
      : variant === 'secondary'
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
        { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text variant="body" color={fg} style={{ fontWeight: '600' }}>
          {label}
        </Text>
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
  label,
  onPress,
  active,
  testID,
}: {
  glyph: string;
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
      <Text variant="heading" color={active ? c.onPrimary : c.text}>
        {glyph}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
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
    borderRadius: radius.pill,
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
