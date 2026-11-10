import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Icon, IconName, IconTile, Input, ListRow, Text } from '../../ui/components';
import { MEMBER_NAME_MAX } from '../../domain/groups/model';
import { AppLogo } from '../../ui/AppLogo';
import { radius, space, useTheme } from '../../ui/theme';

const BENEFITS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'map',
    title: 'Offline maps',
    body: 'Save the trip map and find your way without signal',
  },
  {
    icon: 'group',
    title: 'Follow your leader',
    body: "Get the leader's meeting points and updates when you're in range",
  },
  {
    icon: 'bluetooth',
    title: 'No internet needed',
    body: 'Phones nearby pass updates over Bluetooth',
  },
];

function Peak({
  size,
  color,
  left,
  opacity,
}: {
  size: number;
  color: string;
  left: number;
  opacity: number;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left,
        opacity,
        borderLeftWidth: size,
        borderRightWidth: size,
        borderBottomWidth: size * 1.2,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: color,
      }}
    />
  );
}

/** Scenic header drawn with views so it needs no image assets or native dependencies. */
function Scene() {
  const { c } = useTheme();
  return (
    <View
      style={[styles.scene, { backgroundColor: c.primarySoft, borderColor: c.border }]}
      accessibilityElementsHidden
    >
      <Peak size={90} color={c.primary} opacity={0.22} left={20} />
      <Peak size={110} color={c.primary} opacity={0.34} left={110} />
      <Peak size={70} color={c.primary} opacity={0.46} left={240} />
      <View style={[styles.hill, { backgroundColor: c.primary }]} />
    </View>
  );
}

/** Welcome, then a screen of its own for the name group members will see (required). */
export function OnboardingScreen({ onDone }: { onDone: (name: string) => void }) {
  const [step, setStep] = useState<'welcome' | 'name'>('welcome');
  return step === 'welcome' ? (
    <WelcomeStep onNext={() => setStep('name')} />
  ) : (
    <NameStep onBack={() => setStep('welcome')} onDone={onDone} />
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} testID="onboarding">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <AppLogo size={72} />
          <Text variant="hero" color={c.text} accessibilityRole="header">
            Muster
          </Text>
          <Text color={c.text} style={styles.tagline}>
            Find each other on the trail, even with no signal.
          </Text>
        </View>
        <Scene />
        <Card style={{ paddingVertical: space.xs }}>
          {BENEFITS.map((b, i) => (
            <ListRow
              key={b.title}
              title={b.title}
              subtitle={b.body}
              divider={i < BENEFITS.length - 1}
              leading={<IconTile name={b.icon} />}
            />
          ))}
        </Card>
        <Button label="Get started" icon="navigate" onPress={onNext} testID="onboarding-start" />
      </ScrollView>
    </SafeAreaView>
  );
}

/** The name members of your groups will see. Required, and changeable later in Profile. */
function NameStep({ onBack, onDone }: { onBack: () => void; onDone: (name: string) => void }) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const ready = trimmed.length > 0;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} testID="onboarding-name-step">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.nameTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            hitSlop={8}
            testID="onboarding-back"
          >
            <Icon name="back" size={30} />
          </Pressable>
          <Text variant="label" muted>
            Step 2 of 2
          </Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.nameBody}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          <View
            style={[styles.avatar, { backgroundColor: c.primarySoft }]}
            accessibilityElementsHidden
          >
            <Text variant="hero" color={c.primary}>
              {(trimmed[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <Text variant="title" style={{ textAlign: 'center' }} accessibilityRole="header">
            What should your group call you?
          </Text>
          <Text muted style={{ textAlign: 'center' }}>
            Your group sees this name.
          </Text>
          <Input
            testID="onboarding-name"
            value={name}
            onChangeText={setName}
            maxLength={MEMBER_NAME_MAX}
            placeholder="Your name"
            placeholderTextColor={c.textMuted}
            autoCapitalize="words"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => ready && onDone(trimmed)}
            accessibilityLabel="Your name"
          />
        </ScrollView>
        <View style={styles.nameFooter}>
          <Button
            label="Continue"
            disabled={!ready}
            onPress={() => onDone(trimmed)}
            testID="onboarding-continue"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.gutter, gap: space.xl },
  brand: { alignItems: 'center', gap: space.md, paddingTop: space.xl },
  tagline: { textAlign: 'center', fontSize: 17, lineHeight: 24, paddingHorizontal: space.lg },
  input: {
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 15,
  },
  nameTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
  nameBody: {
    padding: space.gutter,
    gap: space.lg,
    alignItems: 'stretch',
    paddingTop: space.xl,
  },
  avatar: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameFooter: { padding: space.gutter },
  scene: { height: 160, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  hill: {
    position: 'absolute',
    bottom: -60,
    left: -40,
    right: -40,
    height: 100,
    borderRadius: 100,
  },
});
