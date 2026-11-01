import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, IconName, IconTile, ListRow, Text } from '../../ui/components';
import { space, useTheme } from '../../ui/theme';

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

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { c } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} testID="onboarding">
      <ScrollView contentContainerStyle={styles.content}>
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
        <Button label="Get started" icon="navigate" onPress={onDone} testID="onboarding-start" />
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
