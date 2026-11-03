import React, { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, IconName, IconTile, ListRow, Text } from '../../ui/components';
import { MEMBER_NAME_MAX } from '../../domain/groups/model';
import { radius, space, useTheme } from '../../ui/theme';

const BENEFITS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'map', title: 'Offline maps', body: 'Download maps & navigate offline' },
  { icon: 'group', title: 'Group sync', body: 'Share locations, meeting points & updates' },
  { icon: 'bluetooth', title: 'Works offline', body: 'Connect nearby devices with a mesh network' },
];

function Peak({ size, color, left }: { size: number; color: string; left: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left,
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
  const { c, dark } = useTheme();
  return (
    <View
      style={[styles.scene, { backgroundColor: dark ? '#1D2D25' : '#E4EFE3' }]}
      accessibilityElementsHidden
    >
      <Peak size={90} color={dark ? '#35493E' : '#B7C9BA'} left={20} />
      <Peak size={110} color={dark ? '#2B3D33' : '#9DB8A3'} left={110} />
      <Peak size={70} color={dark ? '#223329' : '#86A98F'} left={240} />
      <View style={[styles.hill, { backgroundColor: c.mapMember }]} />
    </View>
  );
}

/** Welcome, then ask for the name group members will see. It is required to continue. */
export function OnboardingScreen({ onDone }: { onDone: (name: string) => void }) {
  const { c } = useTheme();
  const [name, setName] = useState('');
  const ready = name.trim().length > 0;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} testID="onboarding">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text variant="hero" color={c.deep} accessibilityRole="header">
            ▲ TrailMesh
          </Text>
          <Text color={c.text} style={styles.tagline}>
            Stay connected, find each other, anywhere — even offline.
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
        <View style={{ gap: space.sm }}>
          <Text variant="cardTitle">What should your group call you?</Text>
          <TextInput
            testID="onboarding-name"
            value={name}
            onChangeText={setName}
            maxLength={MEMBER_NAME_MAX}
            placeholder="Your name"
            placeholderTextColor={c.textMuted}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => ready && onDone(name.trim())}
            accessibilityLabel="Your name"
            style={[
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surface },
            ]}
          />
          <Text variant="caption" muted>
            Shown to people in your groups. You can change it later in Profile.
          </Text>
        </View>
        <Button
          label="Get started"
          icon="navigate"
          disabled={!ready}
          onPress={() => onDone(name.trim())}
          testID="onboarding-start"
        />
        <Text variant="caption" muted style={{ textAlign: 'center' }}>
          No account needed. Location permission is asked later, when you open the map.
        </Text>
      </ScrollView>
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
  scene: { height: 160, borderRadius: 24, overflow: 'hidden' },
  hill: {
    position: 'absolute',
    bottom: -60,
    left: -40,
    right: -40,
    height: 100,
    borderRadius: 100,
  },
});
